/**
 * Context Pruning & Fast Token Estimator
 * Implements token heuristic estimation and sliding-window context compression
 * to keep conversations within LLM context boundaries while preserving integrity.
 */

import { DEFAULT_MAX_CONTEXT_TOKENS } from '../config/constants.js';

/**
 * Heuristic token estimation ratio (~4 characters per token for English & Code)
 */
const CHARS_PER_TOKEN = 4;
const MESSAGE_OVERHEAD_TOKENS = 4;

/**
 * Per-message token estimate cache. Keyed by message object identity: message
 * objects are treated as immutable once added to a session (sessions only
 * append fresh messages), so repeated scans pay only for newly added messages.
 * Pruned/dropped messages fall out of the cache automatically via GC.
 */
const messageTokenCache = new WeakMap();

/**
 * Estimates token count for a string, part object, message, or array of messages.
 *
 * @param {string|object|Array} input
 * @returns {number} Estimated token count
 */
export function estimateTokens(input) {
  if (input === null || input === undefined) {
    return 0;
  }

  if (typeof input === 'string') {
    if (input.length === 0) return 0;
    return Math.max(1, Math.ceil(input.length / CHARS_PER_TOKEN));
  }

  if (typeof input === 'number' || typeof input === 'boolean') {
    return 1;
  }

  if (Array.isArray(input)) {
    return input.reduce((total, item) => total + estimateTokens(item), 0);
  }

  if (typeof input === 'object') {
    let count = MESSAGE_OVERHEAD_TOKENS;

    // Handle parts array in a message
    if (Array.isArray(input.parts)) {
      for (const part of input.parts) {
        count += estimatePartTokens(part);
      }
      return count;
    }

    // Handle single part object
    return estimatePartTokens(input);
  }

  return 1;
}

/**
 * Estimates total tokens for an array of messages, caching each message's
 * estimate so only unseen messages are computed (incremental delta per message).
 * @param {Array<object>} messages
 * @returns {number}
 */
export function estimateMessagesTokens(messages) {
  if (!Array.isArray(messages)) return 0;

  let total = 0;
  for (const message of messages) {
    if (message === null || typeof message !== 'object') {
      total += estimateTokens(message);
      continue;
    }
    let cached = messageTokenCache.get(message);
    if (cached === undefined) {
      cached = estimateTokens(message);
      messageTokenCache.set(message, cached);
    }
    total += cached;
  }
  return total;
}

/**
 * Estimates total tokens for a Session instance
 * @param {object} session
 * @returns {number}
 */
export function estimateSessionTokens(session) {
  if (!session) return 0;
  const messages =
    typeof session.getMessages === 'function' ? session.getMessages() : session.messages;
  return estimateMessagesTokens(messages || []);
}

/**
 * Estimates token count for a single Gemini part object
 *
 * @param {object} part
 * @returns {number}
 */
export function estimatePartTokens(part) {
  if (!part || typeof part !== 'object') return 0;

  let charCount = 0;

  if (typeof part.text === 'string') {
    charCount += part.text.length;
  }

  if (part.functionCall) {
    charCount += (part.functionCall.name || '').length;
    try {
      charCount += JSON.stringify(part.functionCall.args || {}).length;
    } catch {
      charCount += 50;
    }
  }

  if (part.functionResponse) {
    charCount += (part.functionResponse.name || '').length;
    try {
      charCount += JSON.stringify(part.functionResponse.response || {}).length;
    } catch {
      charCount += 50;
    }
  }

  if (charCount === 0) return 0;
  return Math.max(1, Math.ceil(charCount / CHARS_PER_TOKEN));
}

/**
 * Digest compression: when pruning drains older turns to fit the context
 * window, they are folded into a compact digest message instead of being
 * discarded outright, so earlier context survives in summary form.
 */
const DIGEST_HEADER =
  '[Context digest] Earlier conversation turns were compressed to fit the context window. The lines below summarize the omitted messages:';
const DIGEST_DEFAULT_MAX_CHARS = 4000;
const DIGEST_LINE_MAX_CHARS = 160;
const DIGEST_ROLE_PREFIX = { model: 'assistant', user: 'user', function: 'tool' };

/**
 * Collapses whitespace and truncates a string to maxChars with an ellipsis.
 * @param {string} text
 * @param {number} maxChars
 * @returns {string}
 */
function truncateDigestText(text, maxChars) {
  const collapsed = String(text).replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxChars) return collapsed;
  return `${collapsed.slice(0, maxChars - 1)}…`;
}

/**
 * Compact JSON stringify with truncation; falls back to String() on cycles.
 * @param {any} value
 * @param {number} maxChars
 * @returns {string}
 */
function stringifyDigestValue(value, maxChars) {
  try {
    return truncateDigestText(JSON.stringify(value) ?? '', maxChars);
  } catch {
    return truncateDigestText(String(value), maxChars);
  }
}

/**
 * Builds a single compact extractive digest line for one message.
 * @param {object} message
 * @returns {string} Digest line, or '' when nothing is describable
 */
function digestLineForMessage(message) {
  if (!message || typeof message !== 'object') return '';

  const rolePrefix = DIGEST_ROLE_PREFIX[message.role] || String(message.role || 'unknown');
  const fragments = [];

  if (typeof message.parts === 'string') {
    fragments.push(message.parts);
  } else if (Array.isArray(message.parts)) {
    for (const part of message.parts) {
      if (!part || typeof part !== 'object') continue;
      if (typeof part.text === 'string' && part.text.trim() !== '') {
        fragments.push(part.text.trim());
      }
      if (part.functionCall) {
        fragments.push(
          `calls ${part.functionCall.name}(${stringifyDigestValue(part.functionCall.args || {}, 80)})`,
        );
      }
      if (part.functionResponse) {
        fragments.push(
          `${part.functionResponse.name} result: ${stringifyDigestValue(
            part.functionResponse.response ?? '',
            80,
          )}`,
        );
      }
    }
  }

  if (fragments.length === 0) return '';
  return truncateDigestText(`${rolePrefix}: ${fragments.join(' | ')}`, DIGEST_LINE_MAX_CHARS);
}

/**
 * Builds the user-role digest message that replaces drained older turns.
 * Keeps the most recent lines (closest to the retained window) when the body
 * exceeds maxChars; older lines collapse into an omission note.
 *
 * @param {Array<object>} droppedMessages
 * @param {object} [options={}]
 * @param {number} [options.maxChars=4000] - Max characters of the digest body
 * @returns {object} Message shaped like `{ role: 'user', parts: [{ text }] }`
 */
export function buildSummaryMessage(droppedMessages, options = {}) {
  const maxChars = options.maxChars || DIGEST_DEFAULT_MAX_CHARS;
  const lines = [];
  for (const message of droppedMessages || []) {
    const line = digestLineForMessage(message);
    if (line !== '') lines.push(line);
  }

  if (lines.length === 0) {
    return { role: 'user', parts: [{ text: DIGEST_HEADER }] };
  }

  const kept = [];
  let used = 0;
  let omitted = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const cost = lines[i].length + 1;
    if (used + cost > maxChars) {
      omitted = i + 1;
      break;
    }
    kept.unshift(lines[i]);
    used += cost;
  }

  let text = DIGEST_HEADER;
  if (omitted > 0) {
    text += `\n(+${omitted} older digest lines omitted)`;
  }
  text += `\n${kept.join('\n')}`;
  return { role: 'user', parts: [{ text }] };
}

/**
 * Prunes conversation message history using a sliding-window strategy if token threshold is exceeded.
 * Ensures the initial user prompt / system context and the most recent N turns are preserved.
 * Drained middle turns are compressed into a bounded digest message rather than discarded, so
 * earlier context survives in summary form inside the window.
 *
 * @param {Array<object>} messages - Gemini conversation messages array
 * @param {object} [options={}]
 * @param {number} [options.maxTokens=800000] - Token limit threshold to trigger pruning
 * @param {number} [options.preserveRecentCount=10] - Number of recent messages to preserve
 * @param {boolean} [options.keepFirst=true] - Whether to always preserve the very first message
 * @param {boolean} [options.compress=true] - Fold drained turns into a digest message
 * @param {number} [options.digestMaxChars=4000] - Max characters of the digest body
 * @returns {Array<object>} Pruned message list
 */
export function pruneMessages(messages, options = {}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  const maxTokens = options.maxTokens || DEFAULT_MAX_CONTEXT_TOKENS || 800000;
  const preserveRecentCount = Math.max(2, options.preserveRecentCount ?? 10);
  const keepFirst = options.keepFirst !== false;
  const compress = options.compress !== false;

  const currentTokens = estimateMessagesTokens(messages);
  if (currentTokens <= maxTokens) {
    return [...messages];
  }

  // If conversation is already very short, cannot safely prune middle
  const minKeepCount = (keepFirst ? 1 : 0) + preserveRecentCount;
  if (messages.length <= minKeepCount) {
    return [...messages];
  }

  let firstMsg = keepFirst ? messages[0] : null;
  let middleStart = keepFirst ? 1 : 0;
  const middleEnd = messages.length - preserveRecentCount;
  const dropped = [];

  // If the kept first turn is a tool call whose responses sit in the drain
  // zone, compress the call alongside them instead of leaving it dangling.
  if (firstMsg && messages[middleStart]?.role === 'function') {
    firstMsg = null;
    middleStart = 0;
  }

  const assemble = () => {
    const assembly = firstMsg ? [firstMsg] : [];
    if (compress && dropped.length > 0) {
      assembly.push(buildSummaryMessage(dropped, { maxChars: options.digestMaxChars }));
    }
    assembly.push(...messages.slice(middleStart));
    return assembly;
  };

  // Slide the boundary forward one turn at a time until the assembly fits.
  while (middleStart < middleEnd) {
    dropped.push(messages[middleStart]);
    middleStart++;

    // Never split a tool call from its responses at the drain boundary:
    // if the boundary lands on function responses, compress them together
    // with the call that was just drained.
    while (middleStart < messages.length && messages[middleStart]?.role === 'function') {
      dropped.push(messages[middleStart]);
      middleStart++;
    }

    if (estimateMessagesTokens(assemble()) <= maxTokens) {
      return sanitizeConversationHistory(assemble());
    }
  }

  // Middle fully drained and still over budget: return the compressed digest
  // plus the most recent window (best-effort, mirrors the old hard cutoff).
  return sanitizeConversationHistory(assemble());
}

/**
 * Ensures message sequence validity for Gemini API.
 * Avoids orphaned function responses without preceding model functionCall.
 *
 * @param {Array<object>} messages
 * @returns {Array<object>}
 */
export function sanitizeConversationHistory(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  const sanitized = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg?.role) continue;

    // Check if function response has a valid preceding model message with functionCall
    if (msg.role === 'function') {
      const prev = sanitized[sanitized.length - 1];
      const prevHasCall =
        prev &&
        prev.role === 'model' &&
        Array.isArray(prev.parts) &&
        prev.parts.some((p) => p.functionCall);

      if (!prevHasCall) {
        // Skip orphaned function response to prevent Gemini 400 Bad Request
        continue;
      }
    }

    sanitized.push(msg);
  }

  return sanitized;
}
