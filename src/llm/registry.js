import { GeminiClient } from './gemini.js';
import { OpenAIClient } from './openai.js';

/**
 * Factory to create an LLM Client instance based on provider and adapter options.
 *
 * FAY CLI features 2 native LLM client adapters:
 *   1. `GeminiClient` - Native Google Generative Language API (`provider: 'gemini'`).
 *   2. `OpenAIClient` - Native OpenAI API (`provider: 'openai'`) AND all OpenAI-compatible
 *      endpoints (e.g., Groq, OpenRouter, DeepSeek, Ollama, Together, vLLM, LM Studio, etc.).
 *
 * Routing Rules:
 *   - `provider === 'gemini'` -> `GeminiClient` (Google Gemini API adapter)
 *   - `provider === 'openai'` -> `OpenAIClient` (OpenAI API adapter)
 *   - Custom / unknown provider with `baseUrl` OR `options.adapter === 'openai'` -> `OpenAIClient`
 *     (reuses the OpenAI-compatible Chat Completions adapter with custom base URL endpoint)
 *   - Unknown provider without `baseUrl` or `adapter` -> throws Error(`Unknown provider: ${provider}`)
 *
 * @param {Object} options - Configuration options for the LLM client
 * @param {string} [options.provider='gemini'] - Provider identifier (e.g. 'gemini', 'openai', 'groq', 'openrouter')
 * @param {'gemini'|'openai'} [options.adapter] - Explicit adapter type ('gemini' | 'openai')
 * @param {string} [options.model] - Active model name to use
 * @param {string} [options.apiKey] - API key for authentication
 * @param {string} [options.baseUrl] - Base URL endpoint (used for OpenAI-compatible providers)
 * @param {import('../utils/logger.js').Logger} [options.logger] - Logger instance
 * @param {AbortSignal} [options.signal] - Cancellation abort signal
 * @param {Function} [options.fetch] - Custom fetch implementation (useful for testing)
 * @returns {GeminiClient|OpenAIClient} Instantiated LLM client
 * @throws {Error} If provider is unknown and neither baseUrl nor adapter is specified
 */
export function createLlmClient(options = {}) {
  const { provider = 'gemini', model, apiKey, baseUrl, logger, signal, fetch, locale } = options;
  switch (provider) {
    case 'gemini':
      return new GeminiClient({ model, apiKey, baseUrl, logger, signal, fetch, locale });
    case 'openai':
      return new OpenAIClient({ model, apiKey, baseUrl, logger, signal, fetch, locale });
    default:
      // Fallback: OpenAI-compatible custom endpoints (Groq, OpenRouter, DeepSeek, Ollama, etc.)
      // Any custom provider specifying a baseUrl or adapter: 'openai' reuses OpenAIClient.
      if (baseUrl || options.adapter === 'openai') {
        return new OpenAIClient({ model, apiKey, baseUrl, logger, signal, fetch, locale });
      }
      throw new Error(`Unknown provider: ${provider}`);
  }
}
