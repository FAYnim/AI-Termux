/**
 * Unit Tests: Prompt editor non-TTY fallback + lifecycle helpers.
 * Raw-mode path requires a real TTY; verified manually (e2e task).
 */

import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { describe, test } from 'node:test';
import { closePromptLine, pausePrompt, promptLine, resumePrompt } from '../src/ui/prompt-editor.js';

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
