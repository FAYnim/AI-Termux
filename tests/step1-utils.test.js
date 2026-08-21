import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ansi, stripAnsi, setColorEnabled } from '../src/utils/ansi.js';
import { logger, setVerbose, isVerbose } from '../src/utils/logger.js';

describe('ANSI Utilities (src/utils/ansi.js)', () => {
  test('should format text with ANSI escape codes when enabled', () => {
    setColorEnabled(true);
    const redText = ansi.red('hello');
    assert.match(redText, /\x1b\[31mhello\x1b\[39m/);

    const boldText = ansi.bold('world');
    assert.match(boldText, /\x1b\[1mworld\x1b\[22m/);
  });

  test('should strip ANSI escape codes cleanly', () => {
    setColorEnabled(true);
    const formatted = ansi.bold(ansi.green('success!'));
    assert.equal(stripAnsi(formatted), 'success!');
  });

  test('should handle disable color gracefully', () => {
    setColorEnabled(false);
    const plain = ansi.red('hello');
    assert.equal(plain, 'hello');
    setColorEnabled(true);
  });
});

describe('Logger Utilities (src/utils/logger.js)', () => {
  test('should manage verbose state', () => {
    setVerbose(true);
    assert.equal(isVerbose(), true);

    setVerbose(false);
    assert.equal(isVerbose(), false);
  });

  test('should have all required logging methods', () => {
    assert.equal(typeof logger.info, 'function');
    assert.equal(typeof logger.success, 'function');
    assert.equal(typeof logger.warn, 'function');
    assert.equal(typeof logger.error, 'function');
    assert.equal(typeof logger.agent, 'function');
    assert.equal(typeof logger.step, 'function');
    assert.equal(typeof logger.debug, 'function');
    assert.equal(typeof logger.box, 'function');
  });
});
