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
  contextBudgetLimit,
  createUsage,
  getContextTokens,
  getUsage,
  markRequestStart,
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
  });

  test('contextBudgetLimit takes 85% of the given limit', () => {
    assert.equal(contextBudgetLimit(1000000), 850000);
    assert.equal(contextBudgetLimit(800000), 680000);
  });

  test('contextBudgetLimit falls back to the 800k default on falsy input', () => {
    assert.equal(contextBudgetLimit(undefined), 680000);
    assert.equal(contextBudgetLimit(null), 680000);
    assert.equal(contextBudgetLimit(0), 680000);
  });
});
