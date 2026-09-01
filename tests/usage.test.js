/**
 * Unit Tests: Session Usage Accumulator, Context Budget & Compact Formatting
 * Feature: Session status line (tokens · context · loops)
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { estimateSessionTokens } from '../src/agent/pruner.js';
import { Session } from '../src/agent/session.js';
import {
  accumulateUsage,
  compactTargetLimit,
  contextBudgetLimit,
  createUsage,
  formatCompactTokens,
  getContextTokens,
  getUsage,
  markRequestStart,
  resetUsage,
} from '../src/agent/usage.js';

describe('Session Usage Accumulator', () => {
  test('createUsage returns the zeroed shape', () => {
    assert.deepEqual(createUsage(), {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      llmRequests: 0,
      lastPromptTokens: 0,
      estTokensAtLastRequest: 0,
      updatedAt: null,
    });
  });

  test('accumulateUsage maps the provider usage shape into session metadata', () => {
    const session = new Session({});
    accumulateUsage(session, {
      promptTokenCount: 1000,
      candidatesTokenCount: 50,
      totalTokenCount: 1050,
    });

    const usage = session.metadata.usage;
    assert.equal(usage.promptTokens, 1000);
    assert.equal(usage.completionTokens, 50);
    assert.equal(usage.totalTokens, 1050);
    assert.equal(usage.llmRequests, 1);
    assert.equal(usage.lastPromptTokens, 1000);
    assert.ok(usage.updatedAt);
  });

  test('accumulateUsage sums across repeated responses', () => {
    const session = new Session({});
    accumulateUsage(session, {
      promptTokenCount: 1000,
      candidatesTokenCount: 50,
      totalTokenCount: 1050,
    });
    accumulateUsage(session, {
      promptTokenCount: 2000,
      candidatesTokenCount: 100,
      totalTokenCount: 2100,
    });

    const usage = session.metadata.usage;
    assert.equal(usage.promptTokens, 3000);
    assert.equal(usage.completionTokens, 150);
    assert.equal(usage.totalTokens, 3150);
    assert.equal(usage.llmRequests, 2);
    assert.equal(usage.lastPromptTokens, 2000);
  });

  test('accumulateUsage is a no-op on null/undefined usage', () => {
    const session = new Session({});
    accumulateUsage(session, null);
    accumulateUsage(session, undefined);
    assert.equal(session.metadata.usage, undefined);
  });

  test('getUsage returns a zeroed object when session has no usage', () => {
    const session = new Session({});
    const usage = getUsage(session);
    assert.equal(usage.llmRequests, 0);
    assert.equal(usage.totalTokens, 0);
  });

  test('markRequestStart snapshots the estimator baseline', () => {
    const session = new Session({});
    session.addUserMessage('Hello there, this is a test message.');
    const snapshot = markRequestStart(session);
    assert.ok(snapshot > 0);
    assert.equal(session.metadata.usage.estTokensAtLastRequest, snapshot);
  });

  test('getUsage returns the zeroed shape for corrupt metadata.usage without writing it back', () => {
    const session = new Session({});
    session.metadata.usage = 'bogus';
    assert.deepEqual(getUsage(session), createUsage());
    assert.equal(session.metadata.usage, 'bogus');
  });

  test('accumulateUsage replaces a corrupt metadata.usage and accumulates', () => {
    const session = new Session({});
    session.metadata.usage = 'bogus';
    accumulateUsage(session, {
      promptTokenCount: 100,
      candidatesTokenCount: 10,
      totalTokenCount: 110,
    });
    const usage = session.metadata.usage;
    assert.equal(typeof usage, 'object');
    assert.equal(usage.promptTokens, 100);
    assert.equal(usage.completionTokens, 10);
    assert.equal(usage.totalTokens, 110);
    assert.equal(usage.llmRequests, 1);
  });

  test('accumulateUsage defaults missing counts to zero on partial usage', () => {
    const session = new Session({});
    accumulateUsage(session, { totalTokenCount: 42 });
    const usage = session.metadata.usage;
    assert.equal(usage.totalTokens, 42);
    assert.equal(usage.promptTokens, 0);
    assert.equal(usage.lastPromptTokens, 0);
  });

  test('getUsage is a pure read and does not create metadata.usage', () => {
    const session = new Session({});
    getUsage(session);
    assert.equal(session.metadata.usage, undefined);
  });
});

describe('Context Tokens & Budget', () => {
  test('getContextTokens falls back to the estimator without real usage', () => {
    const session = new Session({});
    session.addUserMessage('Hello there, this is a test message.');
    assert.equal(getContextTokens(session), estimateSessionTokens(session));
  });

  test('getContextTokens anchors on real usage plus drift since the request', () => {
    const session = new Session({});
    session.addUserMessage('First message content.');
    markRequestStart(session);
    // Real API reports 700k context tokens for the last request
    accumulateUsage(session, {
      promptTokenCount: 700000,
      candidatesTokenCount: 10,
      totalTokenCount: 700010,
    });
    // New messages arrive after that request (tool output, etc.)
    session.addFunctionResponseMessage('read_file', { content: 'x'.repeat(400) });

    const usage = session.metadata.usage;
    const expected = 700000 + (estimateSessionTokens(session) - usage.estTokensAtLastRequest);
    assert.equal(getContextTokens(session), expected);
    assert.ok(getContextTokens(session) >= 700000);
    // Estimator drops below the real anchor once history is pruned: clamp at the anchor.
    session.setMessages([]);
    assert.equal(getContextTokens(session), 700000);
  });

  test('contextBudgetLimit takes 92% of the given limit', () => {
    assert.equal(contextBudgetLimit(1000000), 920000);
    assert.equal(contextBudgetLimit(800000), 736000);
  });

  test('contextBudgetLimit falls back to the 800k default on falsy input', () => {
    assert.equal(contextBudgetLimit(undefined), 736000);
    assert.equal(contextBudgetLimit(null), 736000);
    assert.equal(contextBudgetLimit(0), 736000);
  });

  test('getContextTokens falls back to the estimator on corrupt lastPromptTokens', () => {
    const session = new Session({});
    accumulateUsage(session, {
      promptTokenCount: 5000,
      candidatesTokenCount: 10,
      totalTokenCount: 5010,
    });
    session.metadata.usage.lastPromptTokens = 'abc';
    assert.equal(getContextTokens(session), estimateSessionTokens(session));
  });

  test('getContextTokens falls back to the estimator on a negative lastPromptTokens anchor', () => {
    const session = new Session({});
    session.addUserMessage('Hello there, this is a test message.');
    accumulateUsage(session, {
      promptTokenCount: 5000,
      candidatesTokenCount: 10,
      totalTokenCount: 5010,
    });
    session.metadata.usage.lastPromptTokens = -500;
    assert.equal(getContextTokens(session), estimateSessionTokens(session));
  });

  test('getContextTokens ignores a corrupt estTokensAtLastRequest baseline', () => {
    const session = new Session({});
    session.addUserMessage('First message content.');
    markRequestStart(session);
    accumulateUsage(session, {
      promptTokenCount: 700000,
      candidatesTokenCount: 10,
      totalTokenCount: 700010,
    });
    session.addFunctionResponseMessage('read_file', { content: 'x'.repeat(400) });
    session.metadata.usage.estTokensAtLastRequest = 'abc';

    const usage = session.metadata.usage;
    const result = getContextTokens(session);
    assert.ok(Number.isFinite(result));
    assert.ok(result >= usage.lastPromptTokens);
    // Corrupt baseline degrades to the current estimate, so drift is zero.
    assert.equal(result, usage.lastPromptTokens);
  });

  test('resetUsage zeroes the accumulator so a stale anchor cannot leak', () => {
    const session = new Session({});
    session.addUserMessage('First message content.');
    markRequestStart(session);
    accumulateUsage(session, {
      promptTokenCount: 900000,
      candidatesTokenCount: 10,
      totalTokenCount: 900010,
    });
    resetUsage(session);

    assert.deepEqual(session.metadata.usage, createUsage());
    assert.equal(getContextTokens(session), estimateSessionTokens(session));
  });
});

describe('compact ratios', () => {
  test('trigger is 92% of budget, target is 60%, target < trigger', () => {
    assert.equal(contextBudgetLimit(1000000), 920000);
    assert.equal(compactTargetLimit(1000000), 600000);
    assert.ok(compactTargetLimit(1000000) < contextBudgetLimit(1000000));
  });

  test('compactTargetLimit uses the same 800k fallback as contextBudgetLimit', () => {
    assert.equal(compactTargetLimit(undefined), Math.floor(800000 * 0.6));
    assert.equal(compactTargetLimit(null), Math.floor(800000 * 0.6));
  });
});

describe('formatCompactTokens', () => {
  test('below 1000 stays an integer string', () => {
    assert.equal(formatCompactTokens(0), '0');
    assert.equal(formatCompactTokens(950), '950');
    assert.equal(formatCompactTokens(999), '999');
  });

  test('thousands use k with one decimal, trailing .0 dropped', () => {
    assert.equal(formatCompactTokens(1000), '1k');
    assert.equal(formatCompactTokens(23400), '23.4k');
    assert.equal(formatCompactTokens(999949), '999.9k');
  });

  test('millions use M with one decimal, trailing .0 dropped', () => {
    assert.equal(formatCompactTokens(1000000), '1M');
    assert.equal(formatCompactTokens(1234567), '1.2M');
  });

  test('clamps the 1M boundary instead of emitting 1000k', () => {
    assert.equal(formatCompactTokens(999950), '1M');
    assert.equal(formatCompactTokens(999999), '1M');
  });

  test('corrupt input falls back to "0"', () => {
    assert.equal(formatCompactTokens('abc'), '0');
    assert.equal(formatCompactTokens(undefined), '0');
  });
});
