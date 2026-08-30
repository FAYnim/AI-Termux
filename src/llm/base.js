/**
 * Shared LLM client base with timeout/retry helpers reused by adapters.
 */

import { withRetry } from './retry.js';

export class BaseLlmClient {
  constructor(options = {}) {
    this.model = options.model || '';
    this.apiKey = options.apiKey || '';
    this.baseUrl = (options.baseUrl || '').replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.logger = options.logger;
    this.locale = options.locale;
    this.fetch = options.fetch || globalThis.fetch;
  }

  getModel() { return this.model; }
  setModel(model) { this.model = model; }
  getApiKey() { return this.apiKey; }
  setApiKey(apiKey) { this.apiKey = apiKey || ''; }

  buildRequestBody({ contents, tools, systemInstruction, generationConfig }) {
    throw new Error('Not implemented');
  }

  getEndpoint(action = 'generateContent', isStream = false) {
    throw new Error('Not implemented');
  }

  /**
   * Returns AbortSignal combined from timeoutMs and optional parent signal.
   * @private
   */
  _createTimeoutSignal(timeoutMs, parentSignal) {
    const controller = new AbortController();
    let timer = null;
    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
    }
    const onParentAbort = () => {
      if (timer) clearTimeout(timer);
      controller.abort(parentSignal?.reason || new Error('Request aborted by user'));
    };
    if (parentSignal) {
      if (parentSignal.aborted) onParentAbort();
      else parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (parentSignal) parentSignal.removeEventListener('abort', onParentAbort);
    };
    return { signal: controller.signal, cleanup };
  }

  /**
   * Wraps async fn in retry loop. Concrete adapters must implement doRequest.
   */
  async _requestWithRetry(fn, options = {}) {
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const parentSignal = options.signal;
    const { signal, cleanup } = this._createTimeoutSignal(timeoutMs, parentSignal);
    try {
      return await withRetry(fn, { ...options, signal, logger: this.logger });
    } finally {
      cleanup();
    }
  }

  async generateStream(options = {}) {
    throw new Error('Not implemented');
  }

  async generate(options = {}) {
    throw new Error('Not implemented');
  }
}
