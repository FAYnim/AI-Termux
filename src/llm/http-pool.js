/**
 * Shared HTTP connection pool for LLM clients.
 *
 * Node's global fetch (undici-backed) already keeps connections alive for the
 * process, but a process-wide dispatcher is global state — fine for one CLI,
 * not ideal when the agent spawns parallel requests or runs in tests. This
 * module wraps `globalThis.fetch` with an opt-in undici dispatcher when the
 * `undici` package is installed (and reachable via dynamic import).
 *
 * Behavior matrix:
 *   - `undici` installed  -> shared undici Agent reused across all calls.
 *   - `undici` missing    -> plain `globalThis.fetch` fallback. The default
 *                            Node fetch already pools via its built-in
 *                            undici, so ReAct loops still benefit.
 *
 * Either way the function signature matches `fetch(input, init)`. Tests
 * inject custom fetches via the constructor option and bypass this module
 * entirely.
 */

const POOL_SIZE = 256;
const KEEP_ALIVE_MS = 60_000;
const PIPELINING = 1;

let cachedDispatcher = null;
let dispatcherPromise = null;

/**
 * Lazily load undici and construct a single shared Agent. Resolves to
 * `null` when undici is not installed so callers can fall back gracefully.
 * @returns {Promise<object|null>}
 */
async function getSharedDispatcher() {
  if (cachedDispatcher) return cachedDispatcher;
  if (dispatcherPromise) return dispatcherPromise;

  dispatcherPromise = (async () => {
    try {
      const undici = await import('undici');
      if (typeof undici?.Agent !== 'function') return null;
      cachedDispatcher = new undici.Agent({
        connections: POOL_SIZE,
        pipelining: PIPELINING,
        keepAliveTimeout: KEEP_ALIVE_MS,
      });
      return cachedDispatcher;
    } catch {
      return null;
    }
  })();
  return dispatcherPromise;
}

/**
 * `fetch`-compatible wrapper that reuses a single undici Agent when
 * available. Falls back to `globalThis.fetch` unchanged otherwise.
 *
 * @type {typeof globalThis.fetch}
 */
async function pooledFetch(input, init = {}) {
  const dispatcher = await getSharedDispatcher();
  if (!dispatcher) {
    return globalThis.fetch(input, init);
  }
  return globalThis.fetch(input, { ...init, dispatcher });
}

/**
 * Tear down the shared dispatcher (test-only). Subsequent calls rebuild it
 * lazily. No-op when the dispatcher was never created.
 */
export function closePool() {
  if (cachedDispatcher && typeof cachedDispatcher.close === 'function') {
    try {
      cachedDispatcher.close();
    } catch {
      // ignore: closing a partially-initialized agent is non-fatal
    }
  }
  cachedDispatcher = null;
  dispatcherPromise = null;
}

/**
 * Whether the shared undici dispatcher is currently active. Useful for
 * tests asserting the wrapper actually pooled.
 * @returns {boolean}
 */
export function isPoolingActive() {
  return cachedDispatcher !== null;
}

/**
 * Reset the internal cache without closing the dispatcher (test-only).
 */
export function _resetForTests() {
  cachedDispatcher = null;
  dispatcherPromise = null;
}

export { getSharedDispatcher, pooledFetch };
