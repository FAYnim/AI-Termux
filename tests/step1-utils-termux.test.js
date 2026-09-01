import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_CONFIG_DIR_NAME } from '../src/config/constants.js';
import { getConfigRoot } from '../src/utils/termux.js';

describe('Utils: termux.getConfigRoot', () => {
  test('should join home directory with default config dir name constant', () => {
    const root = getConfigRoot();
    assert.ok(root.endsWith(DEFAULT_CONFIG_DIR_NAME));
    assert.equal(DEFAULT_CONFIG_DIR_NAME, '.faycli');
  });

  test('should not contain the legacy .t-ai directory name', () => {
    const root = getConfigRoot();
    assert.ok(!root.endsWith('.t-ai'));
  });
});
