/**
 * Unit Tests: REPL Session Status Line Renderer
 * Feature: Session status line (tokens · context · loops)
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Session } from '../src/agent/session.js';
import { accumulateUsage, createUsage } from '../src/agent/usage.js';
import { renderStatusLine } from '../src/ui/box.js';
import { setColorEnabled, stripAnsi } from '../src/utils/ansi.js';

function realUsage({ prompt, completion, total }) {
  const session = new Session({});
  accumulateUsage(session, {
    promptTokenCount: prompt,
    candidatesTokenCount: completion,
    totalTokenCount: total,
  });
  return session.metadata.usage;
}

describe('renderStatusLine', () => {
  test('shows real usage without tilde, ctx percent and loop counts', () => {
    const line = renderStatusLine({
      usage: realUsage({ prompt: 5000, completion: 200, total: 5200 }),
      contextTokens: 85680,
      contextBudget: 680000,
      iterations: 7,
      maxIterations: 30,
    });
    const plain = stripAnsi(line);
    assert.ok(plain.includes('5.2k tok'), `missing tok: ${plain}`);
    assert.ok(plain.includes('12%'), `missing pct: ${plain}`);
    assert.ok(plain.includes('loop 7/30'), `missing loop: ${plain}`);
  });

  test('tilde prefix and ~0 tok when the provider reports no usage', () => {
    const line = renderStatusLine({
      usage: createUsage(),
      contextTokens: 0,
      contextBudget: 680000,
      iterations: 1,
      maxIterations: 30,
    });
    const plain2 = stripAnsi(line);
    assert.ok(plain2.includes('~0 tok'), `missing tok: ${plain2}`);
    assert.ok(plain2.includes('0%'), `missing pct: ${plain2}`);
    assert.ok(plain2.includes('loop 1/30'), `missing loop: ${plain2}`);
  });

  test('zero-token usage-bearing response still renders without tilde', () => {
    const line = renderStatusLine({
      usage: realUsage({ prompt: 0, completion: 0, total: 0 }),
      contextTokens: 0,
      contextBudget: 680000,
      iterations: 1,
      maxIterations: 30,
    });
    const plain3 = stripAnsi(line);
    assert.ok(plain3.includes('0 tok'), `missing tok: ${plain3}`);
  });

  test('loop segment omitted before any turn ran', () => {
    const plain4 = stripAnsi(
      renderStatusLine({
        usage: createUsage(),
        contextTokens: 0,
        contextBudget: 680000,
        iterations: 0,
        maxIterations: 30,
      }),
    );
    assert.ok(!plain4.includes('loop'), `loop should be absent: ${plain4}`);
    // Fail-soft: bare call (no arguments) renders the same not-yet-billed line
    assert.ok(!stripAnsi(renderStatusLine()).includes('loop'));
  });

  test('large values use M formatting and over-budget ctx exceeds 100%', () => {
    const line = renderStatusLine({
      usage: realUsage({ prompt: 1200000, completion: 45000, total: 1245000 }),
      contextTokens: 710000,
      contextBudget: 680000,
      iterations: 12,
      maxIterations: 30,
    });
    const plain5 = stripAnsi(line);
    assert.ok(plain5.includes('1.2M tok'), `missing tok: ${plain5}`);
    assert.ok(plain5.includes('104%'), `missing pct: ${plain5}`);
    assert.ok(plain5.includes('loop 12/30'), `missing loop: ${plain5}`);
  });

  test('whole line is dimmed', () => {
    // Colors are TTY-gated in src/utils/ansi.js; force them on for this assertion
    setColorEnabled(true);
    const line = renderStatusLine({
      usage: createUsage(),
      contextTokens: 0,
      contextBudget: 680000,
      iterations: 0,
      maxIterations: 0,
    });
    assert.ok(line.startsWith('\x1b[2m'));
    assert.ok(line.endsWith('\x1b[22m'));
  });
});
