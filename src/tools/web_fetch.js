/**
 * Tool: web_fetch
 * Fetch a URL and return readable text (HTML stripped). Built-in fetch only.
 */

import { stripHtml } from '../utils/html.js';

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_BYTES = 100 * 1024;

/** SSRF guard: block non-http(s) schemes and local/private hosts. */
function assertSafeUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: "${rawUrl}"`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Only http(s) URLs are allowed, got "${url.protocol}"`);
  }
  const host = url.hostname.toLowerCase();
  const blocked =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '0.0.0.0' ||
    host === '[::1]' ||
    host === '::' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host);
  if (blocked) {
    throw new Error(`URL blocked by security policy (private/loopback host): "${host}"`);
  }
  return url;
}

/**
 * @param {object} args
 * @param {string} args.url - http(s) URL
 * @param {number} [args.timeoutMs=15000]
 * @param {number} [args.maxBytes=102400]
 * @param {object} [context={}] - may inject context.fetch for tests
 * @returns {Promise<object>}
 */
export async function webFetchTool(args = {}, context = {}) {
  const { url: rawUrl, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES } = args;
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('Missing or invalid "url" argument');
  }
  const url = assertSafeUrl(rawUrl);

  const doFetch = context.fetch || fetch;
  let response;
  try {
    response = await doFetch(url.toString(), {
      signal: AbortSignal.timeout(Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS)),
      redirect: 'follow',
      headers: { 'User-Agent': 'faycli/1.0 (+https://github.com/FAYnim/FAY-CLI)' },
    });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms: "${url}"`);
    }
    throw new Error(`Fetch failed for "${url}": ${err.message || String(err)}`);
  }

  const contentType = response.headers?.get?.('content-type') || '';
  const rawText = await response.text();

  let content = contentType.includes('html') ? stripHtml(rawText) : rawText;
  let truncated = false;
  const limit = Math.max(1024, Number(maxBytes) || DEFAULT_MAX_BYTES);
  if (Buffer.byteLength(content, 'utf-8') > limit) {
    content = `${content.slice(0, limit)}\n... [Content truncated at ${limit} bytes]`;
    truncated = true;
  }

  return {
    url: url.toString(),
    status: response.status,
    contentType,
    content,
    truncated,
    sizeBytes: Buffer.byteLength(rawText, 'utf-8'),
  };
}
