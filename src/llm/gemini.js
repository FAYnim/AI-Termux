/**
 * Gemini API Communicator
 * Zero-dependency pure fetch client supporting SSE streaming and non-streaming modes.
 */

import { DEFAULT_MODEL, DEFAULT_TIMEOUT_MS, DEFAULT_TEMPERATURE } from '../config/constants.js';
import { configManager } from '../config/manager.js';
import { withRetry } from './retry.js';
import { parseSSEStream } from './stream-parser.js';
import {
  createUserMessage,
  createSystemInstruction,
  formatTools,
  normalizeContent
} from './types.js';

export class GeminiClient {
  /**
   * @param {object} [options={}]
   * @param {string} [options.apiKey] - Gemini API Key
   * @param {string} [options.model] - Model name (e.g. 'gemini-2.5-flash')
   * @param {string} [options.apiVersion='v1beta'] - API Version
   * @param {string} [options.baseUrl='https://generativelanguage.googleapis.com'] - Base API URL
   * @param {number} [options.timeoutMs] - Default execution timeout in milliseconds
   * @param {object} [options.generationConfig] - Default generation configuration
   * @param {string|object} [options.systemInstruction] - Default system instruction
   * @param {object} [options.retryOptions] - Custom retry settings
   * @param {Function} [options.fetch] - Custom fetch implementation (for testing)
   * @param {object} [options.logger] - Logger instance
   */
  constructor(options = {}) {
    this.apiKey = options.apiKey !== undefined ? options.apiKey : (configManager.getApiKey() || '');
    this.model = options.model || configManager.get('model') || DEFAULT_MODEL;
    this.apiVersion = options.apiVersion || 'v1beta';
    this.baseUrl = (options.baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? configManager.get('timeoutMs') ?? DEFAULT_TIMEOUT_MS;
    this.useHeaderAuth = options.useHeaderAuth !== undefined
      ? options.useHeaderAuth
      : (configManager.get('gemini.useHeaderAuth') ?? false);
    this.generationConfig = options.generationConfig || {
      temperature: DEFAULT_TEMPERATURE,
      maxOutputTokens: 8192
    };
    this.systemInstruction = options.systemInstruction;
    this.retryOptions = options.retryOptions || {};
    this.fetch = options.fetch || globalThis.fetch;
    this.logger = options.logger;
    this.locale = options.locale;
  }

  /**
   * Sets active model name
   * @param {string} model
   */
  setModel(model) {
    if (!model || typeof model !== 'string') {
      throw new TypeError('Model name must be a non-empty string');
    }
    this.model = model;
  }

  /**
   * Gets current model name
   * @returns {string}
   */
  getModel() {
    return this.model;
  }

  /**
   * Sets Gemini API key
   * @param {string} apiKey
   */
  setApiKey(apiKey) {
    this.apiKey = apiKey || '';
  }

  /**
   * Gets current API key
   * @returns {string}
   */
  getApiKey() {
    return this.apiKey;
  }

  /**
   * Builds full API endpoint URL
   *
   * @param {string} [action='generateContent'] - API action
   * @param {boolean} [isStream=false] - Whether SSE streaming is enabled
   * @returns {string}
   */
  getEndpoint(action = 'generateContent', isStream = false) {
    const streamParam = isStream ? 'alt=sse&' : '';
    // SEC-01: when header auth is enabled, omit API key from URL to prevent
    // leakage via proxy logs, browser DevTools, and server access logs.
    const keyPart = this.useHeaderAuth ? '' : `key=${this.apiKey}`;
    return `${this.baseUrl}/${this.apiVersion}/models/${this.model}:${action}?${streamParam}${keyPart}`;
  }

  /**
   * Builds request headers, including Authorization header when header auth
   * is enabled (SEC-01).
   * @private
   */
  _buildHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.useHeaderAuth) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  /**
   * Builds request payload for Gemini API
   *
   * @param {object} params
   * @param {Array<object>|string} params.contents
   * @param {Array<object>|object} [params.tools]
   * @param {string|object} [params.systemInstruction]
   * @param {object} [params.generationConfig]
   * @returns {object}
   */
  buildRequestBody({ contents, tools, systemInstruction, generationConfig }) {
    let normalizedContents = [];

    if (typeof contents === 'string') {
      normalizedContents = [createUserMessage(contents)];
    } else if (Array.isArray(contents)) {
      normalizedContents = contents.map(normalizeContent);
    } else if (contents && typeof contents === 'object') {
      normalizedContents = [normalizeContent(contents)];
    } else {
      throw new TypeError('contents must be a string, an object, or an array of message contents');
    }

    const payload = {
      contents: normalizedContents
    };

    // Tools formatting
    const formattedTools = formatTools(tools);
    if (formattedTools) {
      payload.tools = formattedTools;
    }

    // System instruction
    const sysInst = systemInstruction || this.systemInstruction;
    if (sysInst) {
      const formattedSys = createSystemInstruction(sysInst);
      if (formattedSys) {
        payload.systemInstruction = formattedSys;
      }
    }

    // Generation config
    const mergedGenConfig = {
      ...this.generationConfig,
      ...(generationConfig || {})
    };
    if (Object.keys(mergedGenConfig).length > 0) {
      payload.generationConfig = mergedGenConfig;
    }

    return payload;
  }

  /**
   * Generates streaming content with Server-Sent Events (SSE).
   *
   * @param {object} options
   * @param {Array<object>|string} options.contents - Messages or prompt string
   * @param {Array<object>|object} [options.tools] - Gemini function declarations
   * @param {string|object} [options.systemInstruction] - System prompt
   * @param {object} [options.generationConfig] - Generation parameters
   * @param {(token: string) => void} [options.onToken] - Real-time token callback
   * @param {(token: string) => void} [options.onChunk] - Alias for onToken
   * @param {(call: { name: string, args: object }) => void} [options.onFunctionCall] - Function call callback
   * @param {(reason: string) => void} [options.onFinish] - Generation finish callback
   * @param {AbortSignal} [options.signal] - Abort controller signal
   * @param {number} [options.timeoutMs] - Custom timeout in ms
   * @returns {Promise<{
   *   text: string,
   *   functionCalls: Array<{ name: string, args: object }>,
   *   finishReason: string|null,
   *   usage: object|null,
   *   rawCandidates: Array<object>
   * }>}
   */
  async generateStream(options = {}) {
    this._validateApiKey();

    const payload = this.buildRequestBody({
      contents: options.contents,
      tools: options.tools,
      systemInstruction: options.systemInstruction,
      generationConfig: options.generationConfig
    });

    const endpoint = this.getEndpoint('streamGenerateContent', true);
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const parentSignal = options.signal;

    const retryOpts = {
      ...this.retryOptions,
      signal: parentSignal,
      logger: this.logger,
      locale: this.locale
    };

    return await withRetry(async () => {
      const { signal, cleanup } = this._createTimeoutSignal(timeoutMs, parentSignal);

      try {
        const response = await this.fetch(endpoint, {
          method: 'POST',
          headers: this._buildHeaders(),
          body: JSON.stringify(payload),
          signal
        });

        if (!response.ok) {
          await this._handleErrorResponse(response);
        }

        return await parseSSEStream(response.body, {
          onToken: options.onToken,
          onChunk: options.onChunk,
          onFunctionCall: options.onFunctionCall,
          onFinish: options.onFinish,
          signal
        });
      } finally {
        cleanup();
      }
    }, retryOpts);
  }

  /**
   * Generates content in synchronous / non-streaming mode.
   *
   * @param {object} options
   * @param {Array<object>|string} options.contents - Messages or prompt string
   * @param {Array<object>|object} [options.tools] - Gemini function declarations
   * @param {string|object} [options.systemInstruction] - System prompt
   * @param {object} [options.generationConfig] - Generation parameters
   * @param {AbortSignal} [options.signal] - Abort controller signal
   * @param {number} [options.timeoutMs] - Custom timeout in ms
   * @returns {Promise<{
   *   text: string,
   *   functionCalls: Array<{ name: string, args: object }>,
   *   finishReason: string|null,
   *   usage: object|null,
   *   raw: object
   * }>}
   */
  async generate(options = {}) {
    this._validateApiKey();

    const payload = this.buildRequestBody({
      contents: options.contents,
      tools: options.tools,
      systemInstruction: options.systemInstruction,
      generationConfig: options.generationConfig
    });

    const endpoint = this.getEndpoint('generateContent', false);
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const parentSignal = options.signal;

    const retryOpts = {
      ...this.retryOptions,
      signal: parentSignal,
      logger: this.logger,
      locale: this.locale
    };

    return await withRetry(async () => {
      const { signal, cleanup } = this._createTimeoutSignal(timeoutMs, parentSignal);

      try {
        const response = await this.fetch(endpoint, {
          method: 'POST',
          headers: this._buildHeaders(),
          body: JSON.stringify(payload),
          signal
        });

        if (!response.ok) {
          await this._handleErrorResponse(response);
        }

        const data = await response.json();
        return this._extractNonStreamResult(data);
      } finally {
        cleanup();
      }
    }, retryOpts);
  }

  /**
   * Helper to ensure API Key is present before making requests.
   * @private
   */
  _validateApiKey() {
    if (!this.apiKey || typeof this.apiKey !== 'string' || this.apiKey.trim() === '') {
      throw new Error(
        'Gemini API key is not configured. Please set it using `termuxai config set apiKey <key>` or set GEMINI_API_KEY environment variable.'
      );
    }
  }

  /**
   * Creates an AbortSignal that combines timeout with a parent signal.
   * @private
   */
  _createTimeoutSignal(timeoutMs, parentSignal) {
    const controller = new AbortController();
    let timer = null;

    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }

    const onParentAbort = () => {
      if (timer) clearTimeout(timer);
      controller.abort(parentSignal?.reason || new Error('Request aborted by user'));
    };

    if (parentSignal) {
      if (parentSignal.aborted) {
        onParentAbort();
      } else {
        parentSignal.addEventListener('abort', onParentAbort, { once: true });
      }
    }

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (parentSignal) {
        parentSignal.removeEventListener('abort', onParentAbort);
      }
    };

    return { signal: controller.signal, cleanup };
  }

  /**
   * Parses non-OK HTTP responses into standard Error instances.
   * @private
   */
  async _handleErrorResponse(response) {
    let errorDetails = null;
    let errorMessage = '';

    try {
      errorDetails = await response.json();
      if (errorDetails?.error?.message) {
        errorMessage = errorDetails.error.message;
      }
    } catch {
      try {
        errorMessage = await response.text();
      } catch {
        errorMessage = response.statusText || `HTTP ${response.status}`;
      }
    }

    if (!errorMessage) {
      errorMessage = `HTTP error ${response.status} ${response.statusText}`.trim();
    }

    const error = new Error(`Gemini API Error (${response.status}): ${errorMessage}`);
    error.status = response.status;
    error.statusCode = response.status;
    error.details = errorDetails;
    throw error;
  }

  /**
   * Extracts text, function calls, finish reason, and usage from non-stream response.
   * @private
   */
  _extractNonStreamResult(data) {
    let text = '';
    const functionCalls = [];
    let finishReason = null;
    let usage = null;

    if (data.usageMetadata) {
      usage = {
        promptTokenCount: data.usageMetadata.promptTokenCount ?? 0,
        candidatesTokenCount: data.usageMetadata.candidatesTokenCount ?? 0,
        totalTokenCount: data.usageMetadata.totalTokenCount ?? 0
      };
    }

    const candidate = data.candidates?.[0];
    if (candidate) {
      finishReason = candidate.finishReason || null;
      const parts = candidate.content?.parts;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (part.text) {
            text += part.text;
          }
          if (part.functionCall) {
            functionCalls.push({
              name: part.functionCall.name,
              args: part.functionCall.args || {}
            });
          }
        }
      }
    }

    return {
      text,
      functionCalls,
      finishReason,
      usage,
      raw: data
    };
  }
}

/**
 * Helper factory function to create a new GeminiClient
 *
 * @param {object} [options={}]
 * @returns {GeminiClient}
 */
export function createGeminiClient(options = {}) {
  return new GeminiClient(options);
}
