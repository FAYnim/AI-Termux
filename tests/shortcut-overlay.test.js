// tests/shortcut-overlay.test.js
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildShortcutOverlay, SHORTCUT_ENTRIES } from '../src/ui/shortcut-overlay.js';
import { stripAnsi } from '../src/utils/ansi.js';

describe('buildShortcutOverlay', () => {
  test('returns non-empty string', () => {
    const result = buildShortcutOverlay();
    assert.ok(typeof result === 'string' && result.length > 0);
  });
  test('contains all shortcut key labels', () => {
    const result = stripAnsi(buildShortcutOverlay());
    for (const entry of SHORTCUT_ENTRIES) {
      assert.ok(result.includes(entry.key), `missing key: ${entry.key}`);
    }
  });
  test('output contains title', () => {
    assert.ok(stripAnsi(buildShortcutOverlay()).includes('Keyboard Shortcuts'));
  });
});

describe('SHORTCUT_ENTRIES', () => {
  test('each entry has key and desc strings', () => {
    for (const e of SHORTCUT_ENTRIES) {
      assert.ok(typeof e.key === 'string' && e.key.length > 0);
      assert.ok(typeof e.desc === 'string' && e.desc.length > 0);
    }
  });
});
