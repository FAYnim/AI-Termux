// tests/history-indicator.test.js
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildPrompt, formatTurnBadge } from '../src/ui/history-indicator.js';
import { stripAnsi } from '../src/utils/ansi.js';

describe('formatTurnBadge', () => {
  test('returns empty string when turn is 0', () => {
    assert.equal(stripAnsi(formatTurnBadge(0)), '');
  });
  test('returns badge containing turn number when turn > 0', () => {
    assert.ok(stripAnsi(formatTurnBadge(3)).includes('3'));
  });
  test('always returns a string', () => {
    assert.equal(typeof formatTurnBadge(0), 'string');
    assert.equal(typeof formatTurnBadge(5), 'string');
  });
});

describe('buildPrompt', () => {
  test('contains appName in output', () => {
    assert.ok(stripAnsi(buildPrompt({ appName: 'fay', turn: 0 })).includes('fay'));
  });
  test('includes turn number when turn > 0', () => {
    assert.ok(stripAnsi(buildPrompt({ appName: 'fay', turn: 2 })).includes('2'));
  });
  test('no bracket indicator when turn is 0', () => {
    assert.ok(!stripAnsi(buildPrompt({ appName: 'fay', turn: 0 })).match(/\[\d+\]/));
  });
});
