/**
 * Context Compactor
 * Replaces old conversation turns with a single summary message so the ReAct
 * loop can run unbounded inside a finite context window. Strategy: LLM-written
 * summary → mechanical digest fallback (pruner.buildSummaryMessage) → noop.
 * Raw replaced turns are archived to <sessionsDir>/<id>.archive.jsonl before
 * the session is rewritten, so nothing is truly lost.
 */

import fs from 'node:fs';
import { logger as defaultLogger } from '../utils/logger.js';
import { buildSummaryMessage } from './pruner.js';
import { getContextTokens, resetUsage } from './usage.js';

/** Recent messages kept verbatim after the summary. Mirrors pruner's preserveRecentCount. */
export const COMPACT_KEEP_RECENT = 10;

/**
 * Instruction appended after the history when asking the LLM for a summary.
 * Provider-agnostic: plain user message, no tool declarations.
 */
const COMPACT_INSTRUCTION = `CONTEXT COMPACTION: The conversation above is being compressed to free context window space. Write a dense summary of everything above as plain text covering, in order:
1. USER GOAL — what the user asked for, verbatim intent
2. KEY DECISIONS — choices made and why
3. FILES TOUCHED — every file read/written/patched and what changed
4. TOOL OUTCOMES — commands run and their results (success/failure), errors still unresolved
5. OPEN THREADS — what remains to be done, in order
Be factual and complete; drop only pleasantries. Do not answer the user, do not continue the task, do not call tools.`;

/**
 * Splits messages into head (to be summarized) and tail (kept verbatim).
 * Boundary slides forward while the tail would start with an orphan
 * function response, so tool calls never get separated from their results
 * at the cut point.
 *
 * @param {Array<object>} messages
 * @param {number} [keepRecentCount=COMPACT_KEEP_RECENT]
 * @returns {{head: Array<object>, tail: Array<object>}}
 */
export function splitForCompact(messages, keepRecentCount = COMPACT_KEEP_RECENT) {
  if (!Array.isArray(messages) || messages.length === 0) return { head: [], tail: [] };
  if (messages.length <= keepRecentCount) return { head: [], tail: [...messages] };

  let boundary = messages.length - keepRecentCount;
  while (boundary < messages.length && messages[boundary]?.role === 'function') {
    boundary++;
  }
  return { head: messages.slice(0, boundary), tail: messages.slice(boundary) };
}

/**
 * Appends archived messages as one JSON per line. Failure is non-fatal —
 * the caller logs and continues; losing the archive must never block
 * compaction of the live session.
 * @param {string} archivePath
 * @param {Array<object>} messages
 */
function appendArchive(archivePath, messages) {
  const payload = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';
  fs.appendFileSync(archivePath, payload, { encoding: 'utf8', mode: 0o600 });
}

/**
 * Compacts a session in place.
 *
 * @param {import('./session.js').Session} session
 * @param {object|null} llmClient - client with .generate({contents, timeoutMs, signal})
 * @param {object} [options={}]
 * @param {number} [options.keepRecentCount=COMPACT_KEEP_RECENT]
 * @param {string|null} [options.archivePath] - null skips archiving
 * @param {AbortSignal} [options.signal] - user abort; rethrown, session untouched
 * @param {number} [options.timeoutMs=30000] - summary request timeout
 * @param {object} [options.logger]
 * @returns {Promise<{compacted: boolean, tokensBefore: number, tokensAfter: number, method: 'llm'|'digest'|'noop', error?: string}>}
 */
export async function compactSession(session, llmClient, options = {}) {
  const logger = options.logger || defaultLogger;
  const keepRecentCount = options.keepRecentCount ?? COMPACT_KEEP_RECENT;
  const tokensBefore = getContextTokens(session);
  const { head, tail } = splitForCompact(session.getMessages(), keepRecentCount);

  if (head.length === 0) {
    return { compacted: false, tokensBefore, tokensAfter: tokensBefore, method: 'noop' };
  }

  let summaryMsg = null;
  let method = 'digest';
  let error;

  if (llmClient && typeof llmClient.generate === 'function') {
    try {
      const result = await llmClient.generate({
        contents: [...head, { role: 'user', parts: [{ text: COMPACT_INSTRUCTION }] }],
        timeoutMs: options.timeoutMs ?? 30000,
        signal: options.signal,
      });
      const text = typeof result?.text === 'string' ? result.text.trim() : '';
      if (text) {
        summaryMsg = { role: 'user', parts: [{ text: `[Compact summary]\n${text}` }] };
        method = 'llm';
      } else {
        error = 'empty summary';
      }
    } catch (err) {
      if (options.signal?.aborted) throw err; // user abort: never rewrite the session
      error = err.message;
    }
  } else {
    error = 'no generate() on client';
  }

  if (!summaryMsg) {
    summaryMsg = buildSummaryMessage(head);
    method = 'digest';
  }

  // Archive AFTER the summary is decided, BEFORE the replace — an abort
  // mid-generate leaves no orphan archive entries.
  if (options.archivePath) {
    try {
      appendArchive(options.archivePath, head);
    } catch (err) {
      logger.warn(`[Compact] archive write failed (${err.message}); continuing without archive`);
    }
  }

  session.setMessages([summaryMsg, ...tail]);
  resetUsage(session); // old real-usage anchor describes the replaced history
  const tokensAfter = getContextTokens(session);
  session.metadata.lastCompact = {
    at: new Date().toISOString(),
    tokensBefore,
    tokensAfter,
    method,
  };
  logger.info(
    `[Compact] ${method}: ${tokensBefore} → ${tokensAfter} tokens (${head.length} msgs archived)`,
  );
  return { compacted: true, tokensBefore, tokensAfter, method, error };
}
