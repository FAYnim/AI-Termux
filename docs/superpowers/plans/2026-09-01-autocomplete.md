# Autocomplete Command & File Include Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** REPL `termuxai` menampilkan popup autocomplete `/command` (awal baris) dan saran file `@path` (setelah spasi), navigasi ↑/↓, select dengan Tab/Enter, dismiss dengan Esc.

**Architecture:** Tiga unit: `src/cli/autocomplete.js` (pure function hitung saran dari text+cursor, zero stream), `src/ui/prompt-editor.js` (line editor raw-mode + render popup, fallback readline non-TTY), dan integrasi kecil di `src/cli/repl.js`. Pola raw-key handling meniru `src/ui/model-menu.js:143-240`.

**Tech Stack:** Node >= 20, `node:readline` (emitKeypressEvents + setRawMode), `node:fs` readdirSync, `node:test` + `assert/strict`. Zero runtime dependency — jangan tambah package apa pun.

**Spec:** `docs/superpowers/specs/2026-09-01-autocomplete-design.md`

**Aturan penting untuk executor:**
- Select file = INSERT PATH saja (`@src/cli/repl.js `), JANGAN baca isi file.
- Trigger `@` harus word-initial (didahului awal string atau whitespace). `email@host` = bukan trigger.
- Skip entries: nama berawalan `.` (dotfiles), `node_modules`, `.git`.
- Autocomplete tidak boleh pernah melempar exception ke prompt — semua I/O di-wrap try/catch, gagal = saran kosong.
- Test runner: `node --test tests/<file>.test.js`. Lint: `npm run lint`.

---

### Task 1: `autocomplete.js` — command suggestions

**Files:**
- Create: `src/cli/autocomplete.js`
- Test: `tests/autocomplete.test.js`

- [ ] **Step 1: Write the failing tests**

Buat `tests/autocomplete.test.js`:

```js
/**
 * Unit Tests: Autocomplete suggestion logic (pure)
 * Feature: slash-command + @file autocomplete
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { getSuggestions, listCommandNames } from '../src/cli/autocomplete.js';

describe('autocomplete: command suggestions', () => {
  test('slash at position 0 returns command list', () => {
    const s = getSuggestions('/', 1, {});
    assert.equal(s.kind, 'command');
    assert.ok(s.items.some((i) => i.value === '/help'));
    assert.ok(s.items.some((i) => i.value === '/provider'));
    assert.equal(s.replaceStart, 0);
    assert.equal(s.replaceEnd, 1);
  });

  test('prefix filter is case-insensitive', () => {
    const s = getSuggestions('/PRO', 4, {});
    assert.equal(s.kind, 'command');
    assert.deepEqual(
      s.items.map((i) => i.value),
      ['/provider'],
    );
  });

  test('no match returns empty items (still a trigger)', () => {
    const s = getSuggestions('/zzz', 4, {});
    assert.equal(s.kind, 'command');
    assert.deepEqual(s.items, []);
  });

  test('slash mid-word is not a trigger', () => {
    assert.equal(getSuggestions('a/b', 3, {}), null);
  });

  test('space after command ends command mode', () => {
    assert.equal(getSuggestions('/help ', 6, {}), null);
  });

  test('listCommandNames derives unique sorted names from help table', () => {
    const names = listCommandNames();
    assert.ok(names.includes('help'));
    assert.ok(names.includes('exit'));
    assert.ok(names.includes('quit'));
    assert.ok(names.includes('provider'));
    assert.ok(!names.some((n) => n.includes(' ')));
    assert.deepEqual(names, [...names].sort());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/autocomplete.test.js`
Expected: FAIL — `Cannot find module '../src/cli/autocomplete.js'`

- [ ] **Step 3: Write minimal implementation**

Buat `src/cli/autocomplete.js`:

```js
/**
 * REPL Autocomplete Suggestion Engine (pure)
 *
 * Computes inline suggestions for the prompt editor from (text, cursor):
 * - '/' at position 0 → slash-command names (from SLASH_COMMANDS_HELP)
 * - '@' word-initial  → filesystem entries under ctx.workingDir (Task 2)
 *
 * Never touches streams; never throws on I/O errors. UI lives in
 * src/ui/prompt-editor.js.
 */

import { SLASH_COMMANDS_HELP } from './slash-commands.js';

/**
 * Unique sorted command names derived from the help table.
 * '/exit, /quit' contributes both; '/provider [id]' contributes 'provider'.
 *
 * @returns {string[]}
 */
export function listCommandNames() {
  const names = new Set();
  for (const { cmd } of SLASH_COMMANDS_HELP) {
    for (const part of cmd.split(',')) {
      const m = part.trim().match(/^\/([a-z][\w-]*)/i);
      if (m) names.add(m[1].toLowerCase());
    }
  }
  return [...names].sort();
}

/**
 * @typedef {Object} Suggestion
 * @property {string} value  Text inserted on select (includes trigger char)
 * @property {string} label  Display text in the popup
 * @property {boolean} [isDir]  File suggestions only: entry is a directory
 */

/**
 * @typedef {Object} SuggestionResult
 * @property {'command'|'file'} kind
 * @property {Suggestion[]} items        May be empty (trigger active, no matches)
 * @property {number} replaceStart       Index in text where replacement begins
 * @property {number} replaceEnd         Index in text where replacement ends
 * @property {string} [dir]              File suggestions only: folder portion being listed (rel, '/'-separated, may be '')
 */

/**
 * Compute inline suggestions for the current buffer + cursor position.
 *
 * @param {string} text   Full prompt text
 * @param {number} cursor Cursor index (0..text.length)
 * @param {{workingDir?: string}} ctx
 * @returns {SuggestionResult|null} null when no trigger is active
 */
export function getSuggestions(text, cursor, ctx = {}) {
  if (typeof text !== 'string' || cursor < 0 || cursor > text.length) return null;

  // ── Command mode: '/' at position 0, cursor before the first whitespace ──
  if (text.startsWith('/')) {
    const before = text.slice(0, cursor);
    if (!/\s/.test(before)) {
      const prefix = before.slice(1).toLowerCase();
      const items = listCommandNames()
        .filter((n) => n.startsWith(prefix))
        .map((n) => ({ value: `/${n}`, label: `/${n}` }));
      return { kind: 'command', items, replaceStart: 0, replaceEnd: cursor };
    }
    return null;
  }

  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/autocomplete.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/cli/autocomplete.js tests/autocomplete.test.js
git commit -m "feat(cli): command autocomplete suggestions (pure logic)"
```

---

### Task 2: `autocomplete.js` — file suggestions (`@`)

**Files:**
- Modify: `src/cli/autocomplete.js` (ganti badan `getSuggestions` setelah command-mode)
- Test: `tests/autocomplete.test.js` (tambah describe block)

- [ ] **Step 1: Write the failing tests**

Tambah di `tests/autocomplete.test.js` (setelah describe command). Fixture dibuat sekali di top-level:

```js
// ── File-suggestion fixtures ─────────────────────────────────────────
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-ac-'));
fs.mkdirSync(path.join(tmpRoot, 'src', 'cli'), { recursive: true });
fs.mkdirSync(path.join(tmpRoot, 'node_modules'), { recursive: true });
fs.mkdirSync(path.join(tmpRoot, '.git'), { recursive: true });
fs.writeFileSync(path.join(tmpRoot, 'README.md'), 'x');
fs.writeFileSync(path.join(tmpRoot, '.hidden'), 'x');
fs.writeFileSync(path.join(tmpRoot, 'src', 'index.js'), 'x');
fs.writeFileSync(path.join(tmpRoot, 'src', 'cli', 'repl.js'), 'x');
fs.writeFileSync(path.join(tmpRoot, 'node_modules', 'dep.js'), 'x');

after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

const fileCtx = { workingDir: tmpRoot };

describe('autocomplete: file suggestions', () => {
  test('@ at start of empty token lists working dir', () => {
    const s = getSuggestions('@', 1, fileCtx);
    assert.equal(s.kind, 'file');
    const labels = s.items.map((i) => i.label);
    assert.ok(labels.includes('README.md'));
    assert.ok(labels.includes('src/'));
    assert.ok(!labels.includes('node_modules'));
    assert.ok(!labels.includes('.hidden'));
    assert.ok(!labels.includes('.git'));
    assert.equal(s.replaceStart, 0);
    assert.equal(s.replaceEnd, 1);
    assert.equal(s.dir, '');
  });

  test('@ after space triggers; email@host does not', () => {
    const s = getSuggestions('lihat @RE', 7, fileCtx);
    assert.equal(s.kind, 'file');
    assert.deepEqual(
      s.items.map((i) => i.value),
      ['@README.md'],
    );
    assert.equal(s.replaceStart, 6);
    assert.equal(s.replaceEnd, 9);
    assert.equal(getSuggestions('email@host', 10, fileCtx), null);
  });

  test('trailing slash drills into directory', () => {
    const s = getSuggestions('@src/', 5, fileCtx);
    assert.equal(s.kind, 'file');
    assert.deepEqual(
      s.items.map((i) => i.label),
      ['cli/', 'index.js'],
    );
    assert.equal(s.dir, 'src');
  });

  test('partial segment filters by prefix, dirs first', () => {
    const s = getSuggestions('@src/c', 6, fileCtx);
    assert.deepEqual(
      s.items.map((i) => i.value),
      ['@src/cli/'],
    );
  });

  test('nonexistent path yields empty items, no throw', () => {
    const s = getSuggestions('@no/such/xyz', 14, fileCtx);
    assert.equal(s.kind, 'file');
    assert.deepEqual(s.items, []);
  });

  test('cursor past token end (whitespace follows) is not a trigger', () => {
    assert.equal(getSuggestions('@README.md ', 11, fileCtx), null);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/autocomplete.test.js`
Expected: FAIL — file tests dapat `null` dari `getSuggestions` (assert kind === 'file' gagal)

- [ ] **Step 3: Implement file mode**

Tambah di atas `getSuggestions` di `src/cli/autocomplete.js`:

```js
import fs from 'node:fs';
import path from 'node:path';

/** Directory entries never offered as suggestions. Dotfiles are skipped separately. */
const SKIP_DIRS = new Set(['node_modules', '.git']);
```

Ganti `return null;` terakhir di badan `getSuggestions` (setelah blok command) dengan:

```js
  // ── File mode: '@' token that starts at string-start or after whitespace ──
  let start = cursor;
  while (start > 0 && !/\s/.test(text[start - 1])) start--;
  let end = cursor;
  while (end < text.length && !/\s/.test(text[end])) end++;
  const token = text.slice(start, end);
  if (!token.startsWith('@')) return null;
  if (start > 0 && !/\s/.test(text[start - 1])) return null;

  const rel = token.slice(1);
  const base = ctx.workingDir || process.cwd();
  const slash = rel.lastIndexOf('/');
  const dirPart = slash >= 0 ? rel.slice(0, slash) : '';
  const filePrefix = (slash >= 0 ? rel.slice(slash + 1) : rel).toLowerCase();
  const dirPath = path.join(base, dirPart);

  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    entries = []; // missing path / EPERM / ENOTDIR → no suggestions, never throw
  }

  const items = entries
    .filter((e) => !e.name.startsWith('.') && !SKIP_DIRS.has(e.name))
    .filter((e) => e.name.toLowerCase().startsWith(filePrefix))
    .sort(
      (a, b) =>
        Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
    )
    .map((e) => {
      const isDir = e.isDirectory();
      const relDir = dirPart ? `${dirPart}/` : '';
      return {
        value: `@${relDir}${e.name}${isDir ? '/' : ''}`,
        label: isDir ? `${e.name}/` : e.name,
        isDir,
      };
    });

  return { kind: 'file', items, replaceStart: start, replaceEnd: end, dir: dirPart };
```

Catatan: blok command di atas sudah `return` sendiri untuk trigger `/`; semua input lain jatuh ke file mode. `text.startsWith('/')` yang tidak match command mode (ada spasi) tetap bisa punya token `@` di belakangnya — itu benar (`/help @src` → saran file).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/autocomplete.test.js`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add src/cli/autocomplete.js tests/autocomplete.test.js
git commit -m "feat(cli): @file autocomplete suggestions via on-demand readdir"
```

---

### Task 3: `prompt-editor.js` — editor + popup + fallback

**Files:**
- Create: `src/ui/prompt-editor.js`
- Test: `tests/prompt-editor.test.js`

Tidak ada unit test untuk jalur raw-mode (butuh TTY asli) — yang dites: fallback non-TTY, pause/resume/close. Jalur TTY diverifikasi manual di Task 5.

- [ ] **Step 1: Write the failing tests**

Buat `tests/prompt-editor.test.js`:

```js
/**
 * Unit Tests: Prompt editor non-TTY fallback + lifecycle helpers.
 * Raw-mode path requires a real TTY; verified manually (e2e task).
 */

import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { describe, test } from 'node:test';
import {
  closePromptLine,
  pausePrompt,
  promptLine,
  resumePrompt,
} from '../src/ui/prompt-editor.js';

describe('prompt editor: non-TTY fallback', () => {
  test('resolves each written line sequentially', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let out = '';
    output.on('data', (c) => {
      out += c.toString();
    });

    const p1 = promptLine({ input, output, prompt: '> ' });
    input.write('satu\n');
    assert.equal(await p1, 'satu');

    const p2 = promptLine({ input, output, prompt: '> ' });
    input.write('dua\n');
    assert.equal(await p2, 'dua');

    assert.ok(out.includes('> '));
    closePromptLine(input);
  });

  test('resolves null when input closes while waiting', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const p = promptLine({ input, output, prompt: '> ' });
    input.end();
    assert.equal(await p, null);
  });

  test('falls back when getSuggestions is absent even with TTY-ish streams', async () => {
    const input = new PassThrough();
    input.isTTY = true;
    const output = new PassThrough();
    output.isTTY = true;
    const p = promptLine({ input, output, prompt: '> ' });
    input.write('halo\n');
    assert.equal(await p, 'halo');
    closePromptLine(input);
  });

  test('pausePrompt/resumePrompt are safe no-ops without a fallback interface', () => {
    const input = new PassThrough();
    assert.doesNotThrow(() => pausePrompt(input));
    assert.doesNotThrow(() => resumePrompt(input));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/prompt-editor.test.js`
Expected: FAIL — `Cannot find module '../src/ui/prompt-editor.js'`

- [ ] **Step 3: Implement the editor**

Buat `src/ui/prompt-editor.js`:

```js
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
      let out = `\x1b[J\r${prompt}${visible}`;
      if (lines.length) out += `\n${lines.join('\n')}`;
      out += `\x1b[${lines.length}A\x1b[${pw + cursor - winStart + 1}G`;
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
          if (sug) {
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/prompt-editor.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/ui/prompt-editor.js tests/prompt-editor.test.js
git commit -m "feat(ui): raw-mode prompt editor with autocomplete popup"
```

---

### Task 4: Integrasi ke `repl.js`

**Files:**
- Modify: `src/cli/repl.js`

- [ ] **Step 1: Ganti imports**

Hapus `import readline from 'node:readline';` (tidak dipakai lagi di repl.js). Tambah:

```js
import { getSuggestions } from './autocomplete.js';
import { closePromptLine, pausePrompt, promptLine, resumePrompt } from '../ui/prompt-editor.js';
```

Hapus import `executeSlashCommand, isSlashCommand` tidak — tetap. Baris `import { executeSlashCommand, isSlashCommand } from './slash-commands.js';` tetap ada.

- [ ] **Step 2: Ganti blok readline + SIGINT + askQuestion**

Hapus blok ini di `startRepl` (sekarang `repl.js:75-123`): `readline.createInterface(...)`, `rl.on('SIGINT', ...)`, dan helper `askQuestion`. Variabel `isBusy`, `activeAbortController`, `lastSigintTime`, `isClosing`, `_wizardActive`, `lastIterations` tetap. Ganti dengan:

```js
  // Ctrl+C while a turn is running aborts it. While idle, the prompt editor
  // owns raw mode and routes Ctrl+C to handleCtrlC below instead.
  const onProcessSigint = () => {
    if (isBusy && activeAbortController) {
      output.write(`\n${ansi.yellow(t('cancelled'))}\n`);
      activeAbortController.abort();
    }
  };
  process.on('SIGINT', onProcessSigint);

  // Double Ctrl+C within 1s exits; mirrors the old rl.on('SIGINT') idle path.
  const handleCtrlC = () => {
    const now = Date.now();
    if (now - lastSigintTime < 1000) {
      output.write(`\n${ansi.cyan(t('goodbye'))}\n\n`);
      isClosing = true;
      return 'exit';
    }
    lastSigintTime = now;
    output.write(`\n${ansi.dim(t('ctrlCExitHint'))}\n`);
    return 'continue';
  };

  const promptSuggestions = (text, cursor) =>
    getSuggestions(text, cursor, { workingDir: orchestrator.workingDir });
```

- [ ] **Step 3: Ganti loop utama**

Di `while (!isClosing)`:

```js
    const rawInput = await promptLine({
      input,
      output,
      prompt: REPL_PROMPT,
      getSuggestions: promptSuggestions,
      onCtrlC: handleCtrlC,
    });
```

(menggantikan `await askQuestion()`).

Di blok slash command, hapus `if (typeof rl.pause === 'function') rl.pause();` dan `if (typeof rl.resume === 'function') rl.resume();` — ganti dengan `pausePrompt(input);` sebelum `executeSlashCommand` dan `resumePrompt(input);` sesudahnya (hanya relevan untuk mode fallback non-TTY; no-op di TTY).

Di cabang `slashResult.action === 'exit'`: hapus `rl.close();` (loop break sudah cukup; cleanup di Step 4).

Setelah loop `while` selesai (akhir fungsi `startRepl`), tambah:

```js
  process.removeListener('SIGINT', onProcessSigint);
  closePromptLine(input);
```

- [ ] **Step 4: Jalankan seluruh test suite**

Run: `npm test`
Expected: PASS semua. Kalau `tests/session-status-repl.test.js` atau test REPL lain hang/fail: penyebab paling umum adalah input PassThrough di-`end()` tanpa newline trailing atau test mengharapkan prompt string tertentu di output — periksa apakah fallback masih menulis `REPL_PROMPT` via `rl.question(prompt, ...)`. JANGAN mengubah test untuk mengakomodasi bug editor; perbaiki editor-nya.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: clean. Kalau biome protes format, `npm run lint:fix` lalu review diff-nya.

- [ ] **Step 6: Commit**

```bash
git add src/cli/repl.js
git commit -m "feat(cli): wire autocomplete popup into REPL prompt loop"
```

---

### Task 5: Verifikasi manual TTY + regression penuh

**Files:** tidak ada (verifikasi)

- [ ] **Step 1: Full test suite + e2e**

Run: `npm test && npm run test:e2e`
Expected: PASS.

- [ ] **Step 2: Manual smoke test di terminal interaktif**

Jalankan `node bin/tai.js` di terminal nyata (bukan pipe), lalu cek checklist:

1. Ketik `/` → popup daftar command muncul; `/pro` → terfilter ke `/provider`; ↓/↑ pindah highlight; Tab → `/provider ` terinsert + spasi, popup hilang.
2. `/help` tetap jalan normal sebagai command (Enter tanpa popup aktif = submit).
3. Ketik `baca @` → popup isi cwd; `@src/` → drill-down; pilih `cli/` dengan Tab → popup isi `src/cli/`; pilih `repl.js` → `@src/cli/repl.js ` terinsert.
4. `email@host` → TIDAK ada popup.
5. Esc → popup hilang, teks utuh; ketik lagi → popup muncul lagi.
6. Ctrl+C sekali → hint exit, prompt redraw; Ctrl+C kedua <1s → keluar bersih, terminal kembali normal (raw mode di-restore — cek `stty -g` tidak perlu, cukup ketikan echo normal).
7. Kirim prompt biasa → agent jalan; Ctrl+C saat agent busy → "cancelled", tidak crash.
8. Resize terminal kecil → popup terpotong rapi, tidak ada artefak.

Expected: semua lolos. Kalau ada artefak render, titik debug: `render()` di prompt-editor.js (erase `\x1b[J` + posisi `\x1b[nA\x1b[mG`).

- [ ] **Step 3: Commit final (kalau ada fix dari smoke test)**

```bash
git add -A
git commit -m "fix(cli): autocomplete rendering adjustments from manual verification"
```

Hanya kalau ada perubahan. Kalau bersih, lewati.

---

## Self-Review Notes

- Spec coverage: Q1 insert-path (Task 2 value + Task 3 insertSelected), Q2 command-name-only (Task 1), Q3 readdir on-demand (Task 2), Q4 skip list (Task 2 SKIP_DIRS + dotfiles), Q5 auto-popup (Task 3 recompute-per-keystroke), Q6 PromptEditor + fallback (Task 3), error handling (try/catch Task 2, raw-restore Task 3 finish), i18n: tidak ada string baru — hint lama dipakai.
- Kontrak tipe `SuggestionResult` didefinisikan Task 1, dipakai Task 2/3/4 dengan nama field identik (`kind, items, replaceStart, replaceEnd, dir`; item: `value, label, isDir`).
- `dir` di header popup file: `sug.dir` diisi Task 2, dibaca Task 3 — konsisten.
