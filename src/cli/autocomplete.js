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
