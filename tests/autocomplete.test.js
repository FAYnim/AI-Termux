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
