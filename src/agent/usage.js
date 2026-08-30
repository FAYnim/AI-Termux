/**
 * Session LLM Usage Tracking
 * Accumulates real API token usage into session metadata and derives the
 * context-size / budget numbers shared by the orchestrator's budget check
 * and the REPL status line. Pure logic — no I/O, no ANSI.
 */

import { estimateSessionTokens } from './pruner.js';

/** Fallback context budget when no explicit maxContextTokens is configured. */
const FALLBACK_MAX_CONTEXT_TOKENS = 800000;

/** Fraction of the context budget where the ReAct loop force-stops. */
const BUDGET_STOP_RATIO = 0.85;

/**
 * Creates a zeroed usage accumulator object
 * @returns {object}
 */
export function createUsage() {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    llmRequests: 0,
    lastPromptTokens: 0,
    estTokensAtLastRequest: 0,
    updatedAt: null,
  };
}

/**
 * Ensures session.metadata.usage exists and returns it (mutates in place)
 * @param {object} session
 * @returns {object}
 */
function ensureUsage(session) {
  if (!session.metadata || typeof session.metadata !== 'object') {
    session.metadata = {};
  }
  if (!session.metadata.usage || typeof session.metadata.usage !== 'object') {
    session.metadata.usage = createUsage();
  }
  return session.metadata.usage;
}

/**
 * Reads the session usage accumulator without mutating (zeroed default)
 * @param {object} session
 * @returns {object}
 */
export function getUsage(session) {
  const usage = session?.metadata?.usage;
  return usage && typeof usage === 'object' ? usage : createUsage();
}

/**
 * Snapshots the estimator baseline right before an LLM request, so
 * getContextTokens() can anchor real prompt tokens against post-request drift.
 * @param {object} session
 * @returns {number} Baseline estimate
 */
export function markRequestStart(session) {
  const usage = ensureUsage(session);
  usage.estTokensAtLastRequest = estimateSessionTokens(session);
  return usage.estTokensAtLastRequest;
}

/**
 * Accumulates one LLM response's usage into session.metadata.usage.
 * Callers pass the adapter-normalized shape {promptTokenCount,
 * candidatesTokenCount, totalTokenCount}. Null usage (provider did not
 * report) is a no-op.
 * @param {object} session
 * @param {object|null} usage
 * @returns {object} The session (for chaining)
 */
export function accumulateUsage(session, usage) {
  if (!usage || typeof usage !== 'object') {
    return session;
  }
  const target = ensureUsage(session);
  const prompt = usage.promptTokenCount ?? 0;
  const completion = usage.candidatesTokenCount ?? 0;
  const total = usage.totalTokenCount ?? prompt + completion;

  target.promptTokens += prompt;
  target.completionTokens += completion;
  target.totalTokens += total;
  target.llmRequests += 1;
  target.lastPromptTokens = prompt;
  target.updatedAt = new Date().toISOString();
  return session;
}
