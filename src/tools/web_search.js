/**
 * Tool: web_search
 * Keyless web search via DuckDuckGo Lite (default) or a self-hosted SearXNG
 * endpoint (config `webSearch.endpoint`, may contain a {query} placeholder).
 */

import { configManager } from '../config/manager.js';
import { decodeEntities, stripHtml } from '../utils/html.js';

const DDG_LITE = 'https://lite.duckduckgo.com/lite/';
const DEFAULT_TIMEOUT_MS = 15000;

function resolveEndpoint(engine) {
  let configured = null;
  try {
    configured = configManager.get('webSearch.endpoint');
  } catch {
    // config unavailable (tests) — fall through to default
  }
  if (engine === 'searxng' && typeof configured === 'string' && configured) {
    return configured;
  }
  return DDG_LITE;
}

/**
 * Parse DDG-Lite / SearXNG result HTML: anchors with http href + their text;
 * snippet = stripped text between the link and the next anchor.
 */
function parseResults(html) {
  const results = [];
  const linkRe = /<a[^>]+href="(http[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  for (;;) {
    match = linkRe.exec(html);
    if (match === null) break;
    const url = decodeEntities(match[1]);
    const title = stripHtml(match[2]);
    if (!title || url.includes('duckduckgo.com')) continue;
    const rest = html.slice(match.index + match[0].length);
    const nextAnchor = rest.search(/<a\b/i);
    const snippetChunk = nextAnchor >= 0 ? rest.slice(0, nextAnchor) : rest.slice(0, 600);
    const snippet = stripHtml(snippetChunk).slice(0, 300);
    results.push({ title, url, snippet });
    if (results.length >= 20) break;
  }
  return results;
}

/**
 * @param {object} args
 * @param {string} args.query
 * @param {number} [args.maxResults=8]
 * @param {string} [args.engine='duckduckgo'] - "duckduckgo" or "searxng"
 * @param {object} [context={}]
 */
export async function webSearchTool(args = {}, context = {}) {
  const { query, maxResults = 8, engine = 'duckduckgo' } = args;
  if (!query || typeof query !== 'string') {
    throw new Error('Missing or invalid "query" argument');
  }

  const endpoint = resolveEndpoint(engine);
  const encoded = encodeURIComponent(query);
  const url = endpoint.includes('{query}')
    ? endpoint.replace('{query}', encoded)
    : `${endpoint}${endpoint.includes('?') ? '&' : '?'}q=${encoded}`;

  const doFetch = context.fetch || fetch;
  let response;
  try {
    response = await doFetch(url, {
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      redirect: 'follow',
      headers: { 'User-Agent': 'faycli/1.0 (+https://github.com/FAYnim/FAY-CLI)' },
    });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new Error(`Search request timed out: "${url}"`);
    }
    throw new Error(`Search failed: ${err.message || String(err)}`);
  }

  const html = await response.text();
  const all = parseResults(html);
  const limit = Math.max(1, Math.min(Number(maxResults) || 8, 20));
  return { query, engine, results: all.slice(0, limit) };
}
