import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getConfigRoot } from '../src/utils/termux.js';
import { DEFAULT_CONFIG_DIR_NAME } from '../src/config/constants.js';

describe('Utils: termux.getConfigRoot', () => {
  test('should join home directory with default config dir name constant', () => {
    const root = getConfigRoot();
    assert.ok(root.endsWith(DEFAULT_CONFIG_DIR_NAME));
    assert.equal(DEFAULT_CONFIG_DIR_NAME, '.termuxai');
  });

  test('should not contain the legacy .t-ai directory name', () => {
    const root = getConfigRoot();
    assert.ok(!root.endsWith('.t-ai'));
  });
});
