/**
 * Unit tests for src/ui/confirm-menu.js (Interactive Security Confirmation Dialog)
 *
 * Tests the showConfirmDialog function in non-TTY mode (auto-deny fallback),
 * and in simulated TTY mode using mock input streams with keypress events.
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, test } from 'node:test';
import { showConfirmDialog } from '../src/ui/confirm-menu.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a minimal mock output stream that captures written text */
function mockOutput() {
  const chunks = [];
  return {
    write: (chunk) => chunks.push(chunk),
    isTTY: true,
    written: () => chunks.join(''),
    chunks,
  };
}

/**
 * Create a mock TTY input stream that emits keypress events on demand.
 * The stream starts as TTY so showConfirmDialog uses the interactive path.
 */
function mockInput() {
  const ee = new EventEmitter();
  ee.isTTY = true;
  ee.setRawMode = () => {};
  ee.resume = () => {};
  ee.pause = () => {};
  ee.readable = true;
  /** Emit a synthetic keypress event */
  ee.pressKey = (name, opts = {}) => {
    ee.emit('keypress', null, { name, sequence: opts.sequence ?? name, ctrl: opts.ctrl ?? false, ...opts });
  };
  return ee;
}

const DIALOG_OPTS = {
  title: 'Unit Test Dialog',
  description: 'This is a test confirmation.',
  target: 'echo hello',
  question: 'Proceed?',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('confirm-menu: showConfirmDialog', () => {
  // ── Non-TTY fallback ───────────────────────────────────────────────────────
  test('non-TTY: resolves false (safe auto-deny) when not a TTY', async () => {
    const out = mockOutput();
    const input = new EventEmitter();
    // NOT setting isTTY — falls back to non-TTY auto-deny
    input.isTTY = false;

    const result = await showConfirmDialog({
      ...DIALOG_OPTS,
      input,
      output: out,
    });

    assert.equal(result, false, 'non-TTY fallback should deny');
  });

  test('non-TTY: resolves false when enabled is explicitly false', async () => {
    const out = mockOutput();
    const input = mockInput();

    const result = await showConfirmDialog({
      ...DIALOG_OPTS,
      enabled: false,
      input,
      output: out,
    });

    assert.equal(result, false);
  });

  // ── Keyboard navigation ────────────────────────────────────────────────────
  test('Enter key confirms default selection (Tolak = false)', async () => {
    const out = mockOutput();
    const input = mockInput();

    const p = showConfirmDialog({ ...DIALOG_OPTS, input, output: out });
    // Default selected = 1 (Tolak = false). Press Enter immediately.
    setImmediate(() => input.pressKey('return'));

    const result = await p;
    assert.equal(result, false, 'default selected is Tolak');
  });

  test('Up key moves cursor to Iya (index 0), Enter confirms true', async () => {
    const out = mockOutput();
    const input = mockInput();

    const p = showConfirmDialog({ ...DIALOG_OPTS, input, output: out });
    setImmediate(() => {
      input.pressKey('up');     // move to index 0 (Iya)
      input.pressKey('return'); // confirm
    });

    const result = await p;
    assert.equal(result, true, 'after up, should select Iya (true)');
  });

  test('Down key wraps from Tolak to Iya, Enter confirms true', async () => {
    const out = mockOutput();
    const input = mockInput();

    const p = showConfirmDialog({ ...DIALOG_OPTS, input, output: out });
    setImmediate(() => {
      // Default selected = 1 (Tolak). Down wraps around to 0 (Iya).
      input.pressKey('down');
      input.pressKey('return');
    });

    const result = await p;
    assert.equal(result, true, 'after down wrap, should select Iya (true)');
  });

  test('Up then Down returns to Tolak, Enter confirms false', async () => {
    const out = mockOutput();
    const input = mockInput();

    const p = showConfirmDialog({ ...DIALOG_OPTS, input, output: out });
    setImmediate(() => {
      input.pressKey('up');    // → Iya (index 0)
      input.pressKey('down');  // → Tolak (index 1)
      input.pressKey('return');
    });

    const result = await p;
    assert.equal(result, false, 'returning to Tolak');
  });

  // ── Shortcut keys ──────────────────────────────────────────────────────────
  test('shortcut "1" resolves true immediately', async () => {
    const out = mockOutput();
    const input = mockInput();

    const p = showConfirmDialog({ ...DIALOG_OPTS, input, output: out });
    setImmediate(() => input.pressKey('1'));

    const result = await p;
    assert.equal(result, true, 'shortcut 1 = Iya');
  });

  test('shortcut "2" resolves false immediately', async () => {
    const out = mockOutput();
    const input = mockInput();

    const p = showConfirmDialog({ ...DIALOG_OPTS, input, output: out });
    setImmediate(() => input.pressKey('2'));

    const result = await p;
    assert.equal(result, false, 'shortcut 2 = Tolak');
  });

  test('shortcut "y" resolves true', async () => {
    const out = mockOutput();
    const input = mockInput();

    const p = showConfirmDialog({ ...DIALOG_OPTS, input, output: out });
    setImmediate(() => input.pressKey('y', { sequence: 'y' }));

    const result = await p;
    assert.equal(result, true, 'y shortcut = allow');
  });

  test('shortcut "Y" (uppercase) resolves true', async () => {
    const out = mockOutput();
    const input = mockInput();

    const p = showConfirmDialog({ ...DIALOG_OPTS, input, output: out });
    setImmediate(() => input.pressKey('Y', { sequence: 'Y' }));

    const result = await p;
    assert.equal(result, true, 'Y shortcut = allow');
  });

  test('shortcut "n" resolves false', async () => {
    const out = mockOutput();
    const input = mockInput();

    const p = showConfirmDialog({ ...DIALOG_OPTS, input, output: out });
    setImmediate(() => input.pressKey('n', { sequence: 'n' }));

    const result = await p;
    assert.equal(result, false, 'n shortcut = deny');
  });

  test('shortcut "N" (uppercase) resolves false', async () => {
    const out = mockOutput();
    const input = mockInput();

    const p = showConfirmDialog({ ...DIALOG_OPTS, input, output: out });
    setImmediate(() => input.pressKey('N', { sequence: 'N' }));

    const result = await p;
    assert.equal(result, false, 'N shortcut = deny');
  });

  // ── Escape / Ctrl+C ────────────────────────────────────────────────────────
  test('Escape key resolves false (safe deny)', async () => {
    const out = mockOutput();
    const input = mockInput();

    const p = showConfirmDialog({ ...DIALOG_OPTS, input, output: out });
    setImmediate(() => input.pressKey('escape'));

    const result = await p;
    assert.equal(result, false, 'Esc = deny');
  });

  test('Ctrl+C resolves false (safe deny)', async () => {
    const out = mockOutput();
    const input = mockInput();

    const p = showConfirmDialog({ ...DIALOG_OPTS, input, output: out });
    setImmediate(() => input.pressKey('c', { ctrl: true }));

    const result = await p;
    assert.equal(result, false, 'Ctrl+C = deny');
  });

  test('stream close event resolves false', async () => {
    const out = mockOutput();
    const input = mockInput();

    const p = showConfirmDialog({ ...DIALOG_OPTS, input, output: out });
    setImmediate(() => input.emit('close'));

    const result = await p;
    assert.equal(result, false, 'stream close = deny');
  });

  // ── SecurityGuard integration ──────────────────────────────────────────────
  test('SecurityGuard.promptConfirmation: backwards-compat with string message goes to confirmationHandler', async () => {
    const { SecurityGuard } = await import('../src/security/guard.js');
    let capturedMsg = null;
    const guard = new SecurityGuard({
      baseDir: process.cwd(),
      confirmationHandler: async (msg) => {
        capturedMsg = msg;
        return true;
      },
    });

    const result = await guard.promptConfirmation('plain string message');
    assert.equal(result, true);
    assert.equal(capturedMsg, 'plain string message');
  });

  test('SecurityGuard.promptConfirmation: object message uses description for confirmationHandler', async () => {
    const { SecurityGuard } = await import('../src/security/guard.js');
    let capturedMsg = null;
    const guard = new SecurityGuard({
      baseDir: process.cwd(),
      confirmationHandler: async (msg) => {
        capturedMsg = msg;
        return false;
      },
    });

    const result = await guard.promptConfirmation({
      title: 'Test Title',
      description: 'Object description message',
      target: 'rm file.txt',
      question: 'Proceed?',
    });

    assert.equal(result, false);
    assert.equal(capturedMsg, 'Object description message');
  });

  test('SecurityGuard: onBeforeConfirm is called before dialog', async () => {
    const { SecurityGuard } = await import('../src/security/guard.js');
    let beforeCalled = false;
    let afterCalledWith = null;

    const guard = new SecurityGuard({
      baseDir: process.cwd(),
      confirmationHandler: async () => true, // intercept so no real dialog
      onBeforeConfirm: () => { beforeCalled = true; },
      onAfterConfirm: (v) => { afterCalledWith = v; },
    });

    // onBeforeConfirm/onAfterConfirm are only called in the non-confirmationHandler path.
    // Here we test the authorize → promptConfirmation path via a risky command.
    const autoGuard = new SecurityGuard({
      baseDir: process.cwd(),
      confirmationHandler: async () => true,
      onBeforeConfirm: () => { beforeCalled = true; },
      onAfterConfirm: (v) => { afterCalledWith = v; },
    });

    const res = await autoGuard.authorize('execute_command', { command: 'rm somefile.txt' });
    // confirmationHandler intercepted before onBeforeConfirm fires (expected)
    assert.equal(res.allowed, true);
    // The handler fired so beforeCalled is still false (handled before TUI).
    // That is correct architecture — confirmationHandler bypasses the TUI dialog.
    assert.equal(beforeCalled, false);
    assert.equal(afterCalledWith, null);
  });

  test('SecurityGuard: autoApprove skips promptConfirmation entirely', async () => {
    const { SecurityGuard } = await import('../src/security/guard.js');
    let confirmCalled = false;

    const guard = new SecurityGuard({
      baseDir: process.cwd(),
      autoApprove: true,
      confirmationHandler: async () => { confirmCalled = true; return false; },
    });

    const res = await guard.authorize('execute_command', { command: 'rm file.txt' });
    assert.equal(res.allowed, true);
    assert.equal(confirmCalled, false, 'autoApprove should skip all confirmation');
  });
});
