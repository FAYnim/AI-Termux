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
      contextTokens: 81600,
      contextBudget: 680000,
      iterations: 7,
      maxIterations: 30,
    });
    assert.equal(stripAnsi(line), '─ 5.2k tok │ ctx 12% │ loop 7/30 ─');
  });

  test('tilde prefix and ~0 tok when the provider reports no usage', () => {
    const line = renderStatusLine({
      usage: createUsage(),
      contextTokens: 0,
      contextBudget: 680000,
      iterations: 1,
      maxIterations: 30,
    });
    assert.equal(stripAnsi(line), '─ ~0 tok │ ctx 0% │ loop 1/30 ─');
  });

  test('loop segment omitted before any turn ran', () => {
    const line = renderStatusLine({
      usage: createUsage(),
      contextTokens: 0,
      contextBudget: 680000,
      iterations: 0,
      maxIterations: 30,
    });
    assert.equal(stripAnsi(line), '─ ~0 tok │ ctx 0% ─');
  });

  test('large values use M formatting and over-budget ctx exceeds 100%', () => {
    const line = renderStatusLine({
      usage: realUsage({ prompt: 1200000, completion: 45000, total: 1245000 }),
      contextTokens: 710000,
      contextBudget: 680000,
      iterations: 12,
      maxIterations: 30,
    });
    assert.equal(stripAnsi(line), '─ 1.2M tok │ ctx 104% │ loop 12/30 ─');
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
