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
 * Estimates total tokens for a Session instance
 * @param {object} session
 * @returns {number}
 */
export function estimateSessionTokens(session) {
  if (!session) return 0;
  const messages =
    typeof session.getMessages === 'function' ? session.getMessages() : session.messages;
  return estimateTokens(messages || []);
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
 * Prunes conversation message history using a sliding-window strategy if token threshold is exceeded.
 * Ensures the initial user prompt / system context and the most recent N turns are preserved.
 *
 * @param {Array<object>} messages - Gemini conversation messages array
 * @param {object} [options={}]
 * @param {number} [options.maxTokens=800000] - Token limit threshold to trigger pruning
 * @param {number} [options.preserveRecentCount=10] - Number of recent messages to preserve
 * @param {boolean} [options.keepFirst=true] - Whether to always preserve the very first message
 * @returns {Array<object>} Pruned message list
 */
export function pruneMessages(messages, options = {}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  const maxTokens = options.maxTokens || DEFAULT_MAX_CONTEXT_TOKENS || 800000;
  const preserveRecentCount = Math.max(2, options.preserveRecentCount ?? 10);
  const keepFirst = options.keepFirst !== false;

  const currentTokens = estimateTokens(messages);
  if (currentTokens <= maxTokens) {
    return [...messages];
  }

  // If conversation is already very short, cannot safely prune middle
  const minKeepCount = (keepFirst ? 1 : 0) + preserveRecentCount;
  if (messages.length <= minKeepCount) {
    return [...messages];
  }

  const firstMsg = keepFirst ? messages[0] : null;
  const startIndex = keepFirst ? 1 : 0;

  // Slice candidates for pruning (the middle portion)
  const candidateMiddle = messages.slice(startIndex, messages.length - preserveRecentCount);
  const recentSlice = messages.slice(messages.length - preserveRecentCount);

  // Iteratively remove from candidateMiddle until under token budget
  while (candidateMiddle.length > 0) {
    // Remove oldest item from middle
    candidateMiddle.shift();

    const candidateAssembly = [...(firstMsg ? [firstMsg] : []), ...candidateMiddle, ...recentSlice];

    if (estimateTokens(candidateAssembly) <= maxTokens) {
      return sanitizeConversationHistory(candidateAssembly);
    }
  }

  // If middle is completely drained and still over budget, return sanitized first + recent
  const minimalAssembly = [...(firstMsg ? [firstMsg] : []), ...recentSlice];

  return sanitizeConversationHistory(minimalAssembly);
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
