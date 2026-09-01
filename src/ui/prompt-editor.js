/**
 * REPL Prompt Line Editor
 *
 * Single-line raw-mode editor with an inline autocomplete popup rendered
 * below the input line. Trigger logic is injected via getSuggestions
 * (see src/cli/autocomplete.js) — this module is UI only.
 *
 * Raw key handling follows the established pattern in src/ui/model-menu.js:
 * setRawMode(true) + readline.emitKeypressEvents, cleanup on every exit path.
 *
 * Non-TTY (piped input, tests) falls back to a persistent readline
 * interface per input stream — behavior identical to the old repl.js loop.
 */

import readline from 'node:readline';
import { ansi } from '../utils/ansi.js';

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const POPUP_MAX = 8;

const visibleLen = (s) => s.replace(ANSI_RE, '').length;
const truncate = (s, max) => (visibleLen(s) > max ? `${s.slice(0, Math.max(0, max - 1))}…` : s);

/** Persistent readline interfaces for the non-TTY fallback, keyed by input stream. */
const fallbackRl = new WeakMap();

/**
 * Ask one line of input with optional autocomplete popup.
 *
 * @param {object} opts
 * @param {NodeJS.ReadableStream} opts.input
 * @param {NodeJS.WritableStream} opts.output
 * @param {string} [opts.prompt='']
 * @param {(text: string, cursor: number) => import('../cli/autocomplete.js').SuggestionResult|null} [opts.getSuggestions]
 * @param {() => 'continue'|'exit'} [opts.onCtrlC]
 * @returns {Promise<string|null>} null on close / exit / Ctrl+C-exit
 */
export function promptLine(opts = {}) {
  const { input, output, prompt = '', getSuggestions, onCtrlC } = opts;
  const tty = Boolean(input?.isTTY && output?.isTTY);
  if (!tty || typeof getSuggestions !== 'function') {
    return fallbackPromptLine(input, output, prompt);
  }

  return new Promise((resolve) => {
    let text = '';
    let cursor = 0;
    /** @type {import('../cli/autocomplete.js').SuggestionResult|null} */
    let sug = null;
    let sel = 0;
    let done = false;

    if (typeof input.setRawMode === 'function') {
      try {
        input.setRawMode(true);
      } catch {
        /* piped-ish stream claiming TTY — ignore */
      }
    }
    readline.emitKeypressEvents(input);
    // emitKeypressEvents keeps a permanent 'data' listener on the stream;
    // resume so the stream flows again after a previous finish() paused it.
    if (typeof input.resume === 'function') input.resume();

    const recompute = () => {
      const s = getSuggestions(text, cursor);
      if (s && s.items.length) {
        sug = s;
        sel = 0;
      } else {
        sug = null;
      }
    };

    const insertSelected = () => {
      const item = sug.items[sel];
      if (!item) return;
      // Directories keep the popup open for drill-down (no trailing space);
      // commands and files get one.
      const pad = item.isDir ? '' : ' ';
      text = text.slice(0, sug.replaceStart) + item.value + pad + text.slice(sug.replaceEnd);
      cursor = sug.replaceStart + item.value.length + pad.length;
      recompute();
    };

    const finish = (value) => {
      if (done) return;
      done = true;
      input.removeListener('keypress', onKey);
      input.removeListener('close', onClose);
      // Release stdin's 'data' listener (added by emitKeypressEvents) so a
      // finished REPL can exit — a flowing stdin keeps the event loop alive.
      // Mirrors what the old rl.close() did. Next promptLine resumes it.
      if (typeof input.pause === 'function') input.pause();
      try {
        if (input.isTTY && typeof input.setRawMode === 'function') input.setRawMode(false);
      } catch {
        /* ignore */
      }
      // Erase popup rows, keep the submitted line, end with a newline.
      output.write('\x1b[J\r\n');
      resolve(value);
    };

    const onClose = () => finish(null);

    const render = () => {
      const cols = output.columns || 80;
      const pw = visibleLen(prompt);
      const maxText = Math.max(1, cols - pw - 1);
      // Long input scrolls from the left so the cursor stays visible.
      const winStart =
        text.length > maxText
          ? Math.max(0, Math.min(cursor - maxText + 1, text.length - maxText))
          : 0;
      const visible = text.slice(winStart, winStart + maxText);

      const lines = [];
      if (sug) {
        if (sug.kind === 'file') {
          lines.push(ansi.dim(`  @${sug.dir ? `${sug.dir}/` : ''}`));
        }
        const first = Math.min(
          Math.max(sel - POPUP_MAX + 1, 0),
          Math.max(sug.items.length - POPUP_MAX, 0),
        );
        sug.items.slice(first, first + POPUP_MAX).forEach((it, i) => {
          const idx = first + i;
          const label = truncate(it.label, cols - 4);
          lines.push(idx === sel ? `  ${ansi.inverse(`▸ ${label}`)}` : `   ${label}`);
        });
        if (sug.items.length > POPUP_MAX) {
          lines.push(ansi.dim(`  ${sel + 1}/${sug.items.length}`));
        }
      }

      // Erase everything from this line down, repaint, park the cursor.
      // NOTE: never emit `\x1b[0A` — Windows conhost treats 0 as 1, parking
      // the cursor one row too high so the next erase eats the line above.
      let out = `\x1b[J\r${prompt}${visible}`;
      if (lines.length) {
        out += `\n${lines.join('\n')}\x1b[${lines.length}A`;
      }
      out += `\x1b[${pw + cursor - winStart + 1}G`;
      output.write(out);
    };

    const onKey = (_chunk, key) => {
      if (!key) return;

      if (key.ctrl && key.name === 'c') {
        if (typeof onCtrlC === 'function' && onCtrlC() === 'exit') {
          finish(null);
          return;
        }
        render(); // hint was printed above; repaint prompt below it
        return;
      }

      switch (key.name) {
        case 'return':
        case 'enter':
          // Enter completes only while the token is still partial.
          // Exact match (typed "/exit" in full) → Enter submits, like Tab
          // would have done one keystroke earlier.
          if (sug && text.slice(sug.replaceStart, sug.replaceEnd) !== sug.items[sel]?.value) {
            insertSelected();
            render();
            return;
          }
          finish(text);
          return;
        case 'tab':
          if (sug) insertSelected();
          render();
          return;
        case 'escape':
          sug = null;
          render();
          return;
        case 'up':
          if (sug) {
            sel = (sel - 1 + sug.items.length) % sug.items.length;
            render();
          }
          return;
        case 'down':
          if (sug) {
            sel = (sel + 1) % sug.items.length;
            render();
          }
          return;
        case 'left':
          if (cursor > 0) cursor--;
          recompute();
          render();
          return;
        case 'right':
          if (cursor < text.length) cursor++;
          recompute();
          render();
          return;
        case 'home':
          cursor = 0;
          recompute();
          render();
          return;
        case 'end':
          cursor = text.length;
          recompute();
          render();
          return;
        case 'backspace':
          if (cursor > 0) {
            text = text.slice(0, cursor - 1) + text.slice(cursor);
            cursor--;
          }
          recompute();
          render();
          return;
        case 'delete':
          if (cursor < text.length) {
            text = text.slice(0, cursor) + text.slice(cursor + 1);
          }
          recompute();
          render();
          return;
        default:
          break;
      }

      // Printable input (multi-byte safe via key.sequence).
      if (!key.ctrl && !key.meta && typeof key.sequence === 'string' && key.sequence.length) {
        text = text.slice(0, cursor) + key.sequence + text.slice(cursor);
        cursor += key.sequence.length;
        recompute();
        render();
      }
    };

    input.on('keypress', onKey);
    input.on('close', onClose);
    render();
  });
}

/**
 * Non-TTY fallback: one readline interface per input stream, reused across
 * prompts so buffered lines written between turns are not lost.
 *
 * @param {NodeJS.ReadableStream} input
 * @param {NodeJS.WritableStream} output
 * @param {string} prompt
 * @returns {Promise<string|null>}
 */
function fallbackPromptLine(input, output, prompt) {
  return new Promise((resolve) => {
    let rl = fallbackRl.get(input);
    if (!rl) {
      rl = readline.createInterface({ input, output, terminal: Boolean(output?.isTTY) });
      rl.on('close', () => fallbackRl.delete(input));
      fallbackRl.set(input, rl);
    }
    let settled = false;
    const onClose = () => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    };
    rl.once('close', onClose);
    rl.question(prompt, (answer) => {
      settled = true;
      rl.removeListener('close', onClose);
      resolve(answer);
    });
  });
}

/** Pause the fallback readline so a child wizard can own stdin (mirrors old rl.pause). */
export function pausePrompt(input) {
  const rl = fallbackRl.get(input);
  if (rl && typeof rl.pause === 'function') rl.pause();
}

/** Resume the fallback readline after a child wizard finishes. */
export function resumePrompt(input) {
  const rl = fallbackRl.get(input);
  if (rl && typeof rl.resume === 'function') rl.resume();
}

/** Close the fallback readline (call when the REPL loop ends). */
export function closePromptLine(input) {
  const rl = fallbackRl.get(input);
  if (rl) {
    fallbackRl.delete(input);
    rl.close();
  }
}
