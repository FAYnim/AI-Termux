// tests/thought-display.test.js
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  createThoughtDisplay,
  extractThoughtBlocks,
  stripThoughtBlocks,
} from '../src/ui/thought-display.js';

describe('extractThoughtBlocks', () => {
  test('extracts text inside <think> tags', () => {
    const result = extractThoughtBlocks('hello <think>deep reasoning</think> world');
    assert.deepEqual(result, ['deep reasoning']);
  });
  test('returns empty array when no think tags', () => {
    assert.deepEqual(extractThoughtBlocks('plain text'), []);
  });
  test('handles multiple think blocks', () => {
    const result = extractThoughtBlocks('<think>a</think> mid <think>b</think>');
    assert.deepEqual(result, ['a', 'b']);
  });
  test('handles multiline think blocks', () => {
    const result = extractThoughtBlocks('<think>\nline1\nline2\n</think>');
    assert.deepEqual(result, ['\nline1\nline2\n']);
  });
});

describe('stripThoughtBlocks', () => {
  test('removes <think> tags and content', () => {
    assert.equal(stripThoughtBlocks('hello <think>ignore</think> world'), 'hello  world');
  });
  test('no-op when no think tags', () => {
    assert.equal(stripThoughtBlocks('plain'), 'plain');
  });
});

describe('createThoughtDisplay', () => {
  test('starts disabled', () => {
    const td = createThoughtDisplay({ stream: { write: () => {} } });
    assert.equal(td.isEnabled(), false);
  });
  test('toggle flips state', () => {
    const td = createThoughtDisplay({ stream: { write: () => {} } });
    td.toggle(); assert.equal(td.isEnabled(), true);
    td.toggle(); assert.equal(td.isEnabled(), false);
  });
  test('processToken strips think block when disabled', () => {
    const written = [];
    const td = createThoughtDisplay({ stream: { write: (s) => written.push(s) } });
    const result = td.processToken('<think>reasoning</think>actual text');
    assert.equal(result, 'actual text');
    assert.equal(written.length, 0);
  });
  test('processToken prints thought when enabled', () => {
    const written = [];
    const td = createThoughtDisplay({ stream: { write: (s) => written.push(s) } });
    td.toggle();
    td.processToken('<think>my reasoning</think>answer');
    assert.ok(written.join('').includes('my reasoning'));
  });
});

describe('/thoughts slash command', () => {
  test('toggles thought display when available in context', async () => {
    const { executeSlashCommand } = await import('../src/cli/slash-commands.js');
    const written = [];
    const stream = { write: (s) => written.push(s) };
    const td = createThoughtDisplay({ stream });
    const res1 = await executeSlashCommand('/thoughts', { thoughtDisplay: td, stream });
    assert.equal(res1.handled, true);
    assert.equal(res1.action, 'thoughts_toggle');
    assert.equal(res1.enabled, true);
    assert.equal(td.isEnabled(), true);
    assert.ok(written.join('').includes('ON'));

    const res2 = await executeSlashCommand('/thoughts', { thoughtDisplay: td, stream });
    assert.equal(res2.handled, true);
    assert.equal(res2.action, 'thoughts_toggle');
    assert.equal(res2.enabled, false);
    assert.equal(td.isEnabled(), false);
    assert.ok(written.join('').includes('OFF'));
  });

  test('reports error when thoughtDisplay missing from context', async () => {
    const { executeSlashCommand } = await import('../src/cli/slash-commands.js');
    const written = [];
    const stream = { write: (s) => written.push(s) };
    const res = await executeSlashCommand('/thoughts', { stream });
    assert.equal(res.handled, true);
    assert.equal(res.action, 'thoughts_error');
    assert.equal(res.error, true);
    assert.ok(written.join('').includes('not available'));
  });
});

