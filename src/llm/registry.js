import { GeminiClient } from './gemini.js';
import { OpenAIClient } from './openai.js';

export function createLlmClient(options = {}) {
  const { provider = 'gemini', model, apiKey, baseUrl, logger, signal, fetch } = options;
  switch (provider) {
    case 'gemini':
      return new GeminiClient({ model, apiKey, baseUrl, logger, signal, fetch });
    case 'openai':
      return new OpenAIClient({ model, apiKey, baseUrl, logger, signal, fetch });
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
