/**
 * Network Resilience Layer: Exponential Backoff Retry with Jitter
 * Handles HTTP 429 (Rate Limit), 503 (Service Unavailable), and cellular network drops.
 */

import { t } from '../i18n/index.js';
import { logger } from '../utils/logger.js';

export const RETRYABLE_HTTP_STATUSES = [429, 503];

export const RETRYABLE_NETWORK_CODES = [
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'ERR_NETWORK'
];

/**
 * Checks if a given error is transient and eligible for retry.
 *
 * @param {Error|any} error
 * @returns {boolean}
 */
export function isRetryableError(error) {
  if (!error) return false;

  // Never retry if explicitly aborted
  if (error.name === 'AbortError' || error.message?.includes('abort')) {
    return false;
  }

  // Check explicit retryable flag
  if (error.isRetryable === true) {
    return true;
  }

  // Check HTTP status code
  const status = error.status || error.statusCode;
  if (status && RETRYABLE_HTTP_STATUSES.includes(Number(status))) {
    return true;
  }

  // Check Node.js / System error code
  if (error.code && RETRYABLE_NETWORK_CODES.includes(error.code)) {
    return true;
  }

  // Check common network error message signatures
  const message = (error.message || '').toLowerCase();
  if (
    message.includes('fetch failed') ||
    message.includes('network error') ||
    message.includes('socket hang up') ||
    message.includes('etimedout') ||
    message.includes('econnreset') ||
    message.includes('eai_again') ||
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('service unavailable') ||
    message.includes('resource exhausted')
  ) {
    return true;
  }

  return false;
}

/**
 * Promisified sleep that respects AbortSignal
 *
 * @param {number} ms - Sleep duration in milliseconds
 * @param {AbortSignal} [signal] - Optional abort signal
 * @returns {Promise<void>}
 */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(signal.reason || new Error('Aborted'));
    }

    let timer = null;

    const onAbort = () => {
      if (timer) clearTimeout(timer);
      reject(signal?.reason || new Error('Aborted'));
    };

    timer = setTimeout(() => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve();
    }, ms);

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * Calculates exponential backoff delay with random jitter.
 * Formula: Math.min(initialDelayMs * 2^attempt + random(jitterMs), maxDelayMs)
 *
 * @param {number} attempt - 0-indexed attempt number
 * @param {object} [options={}]
 * @param {number} [options.initialDelayMs=1000]
 * @param {number} [options.maxDelayMs=15000]
 * @param {number} [options.jitterMs=500]
 * @returns {number} Delay in milliseconds
 */
export function calculateBackoffDelay(attempt, options = {}) {
  const initialDelayMs = options.initialDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 15000;
  const jitterMs = options.jitterMs ?? 500;

  const exponential = initialDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * jitterMs;
  return Math.min(exponential + jitter, maxDelayMs);
}

/**
 * Wraps an async function execution with exponential backoff retry.
 *
 * @template T
 * @param {() => Promise<T>} fn - Async function to execute
 * @param {object} [options={}]
 * @param {number} [options.maxRetries=3] - Maximum retry attempts
 * @param {number} [options.initialDelayMs=1000] - Base delay in ms
 * @param {number} [options.maxDelayMs=15000] - Maximum delay cap in ms
 * @param {number} [options.jitterMs=500] - Random jitter ceiling in ms
 * @param {AbortSignal} [options.signal] - Abort signal to cancel retry loop
 * @param {Function} [options.onRetry] - Custom callback called before each retry
 * @param {object} [options.logger] - Custom logger (defaults to system logger)
 * @param {string} [options.locale] - Locale for the retry warning message
 * @param {Function} [options.shouldRetry] - Custom predicate to determine retryability
 * @returns {Promise<T>}
 */
export async function withRetry(fn, options = {}) {
  const maxRetries = options.maxRetries ?? 3;
  const log = options.logger || logger;
  const shouldRetry = options.shouldRetry || isRetryableError;
  const signal = options.signal;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Check if aborted before executing
    if (signal?.aborted) {
      throw signal.reason || new Error('Execution aborted');
    }

    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Never retry if aborted or beyond maximum retries
      if (signal?.aborted) {
        throw signal.reason || error;
      }

      if (attempt >= maxRetries) {
        throw error;
      }

      // Check if error is transient / retryable
      if (!shouldRetry(error)) {
        throw error;
      }

      const delay = calculateBackoffDelay(attempt, options);
      const attemptNumber = attempt + 1;
      const statusDesc = error.status ? `HTTP ${error.status}` : error.code || 'Network Issue';

      if (typeof options.onRetry === 'function') {
        options.onRetry({
          attempt: attemptNumber,
          maxRetries,
          delay,
          error
        });
      } else if (log && typeof log.warn === 'function') {
        const sec = (delay / 1000).toFixed(1);
        log.warn(
          t(
            'networkBusy',
            { status: statusDesc, seconds: sec, attempt: attemptNumber, maxRetries },
            options.locale,
          ),
        );
      }

      // Wait delay with abort signal support
      await sleep(delay, signal);
    }
  }

  throw lastError;
}
