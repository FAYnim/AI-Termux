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

/**
 * Estimates the context size of the NEXT request: the real prompt-token
 * count of the last request (ground truth) plus the estimated drift of
 * messages appended since it. Falls back to the pure estimator when no
 * real usage has been recorded. Never returns less than the real anchor.
 * @param {object} session
 * @returns {number}
 */
export function getContextTokens(session) {
  const est = estimateSessionTokens(session);
  const usage = getUsage(session);
  if (!usage.lastPromptTokens) {
    return est;
  }
  const delta = Math.max(0, est - usage.estTokensAtLastRequest);
  return Math.max(usage.lastPromptTokens, usage.lastPromptTokens + delta);
}

/**
 * Single source for the budget force-stop limit: 85% of the max context
 * tokens, with the 800k fallback the orchestrator has always used for a
 * falsy limit. Both the orchestrator check and the REPL display call this.
 * @param {number|undefined} maxContextTokens
 * @returns {number}
 */
export function contextBudgetLimit(maxContextTokens) {
  return Math.floor((maxContextTokens || FALLBACK_MAX_CONTEXT_TOKENS) * BUDGET_STOP_RATIO);
}

/**
 * Formats a token count compactly: <1000 → "950"; <1M → one decimal in k
 * with a trailing ".0" dropped ("23.4k", "1k"); ≥1M → same in M ("1.2M").
 * Rounds half-up at the one decimal.
 * @param {number} n
 * @returns {string}
 */
export function formatCompactTokens(n) {
  const num = Number(n) || 0;
  if (num < 1000) {
    return String(Math.floor(num));
  }
  if (num < 1000000) {
    const k = Math.round((num / 1000) * 10) / 10;
    return `${k % 1 === 0 ? String(k) : k.toFixed(1)}k`;
  }
  const m = Math.round((num / 1000000) * 10) / 10;
  return `${m % 1 === 0 ? String(m) : m.toFixed(1)}M`;
}
