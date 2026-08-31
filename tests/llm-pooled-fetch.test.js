/**
 * Verifies LLM clients default to the shared pooledFetch wrapper.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GeminiClient } from '../src/llm/gemini.js';
import { pooledFetch } from '../src/llm/http-pool.js';
import { OpenAIClient } from '../src/llm/openai.js';

describe('LLM clients wire pooledFetch by default', () => {
  it('GeminiClient falls back to pooledFetch when no fetch is injected', () => {
    const client = new GeminiClient({ apiKey: 'k', model: 'gemini-2.5-flash' });
    assert.equal(client.fetch, pooledFetch);
  });

  it('OpenAIClient falls back to pooledFetch when no fetch is injected', () => {
    const client = new OpenAIClient({ apiKey: 'k', model: 'gpt-4o-mini' });
    assert.equal(client.fetch, pooledFetch);
  });

  it('injected fetch wins over pooledFetch', () => {
    const customFetch = () => Promise.reject(new Error('custom'));
    const gemini = new GeminiClient({ apiKey: 'k', model: 'm', fetch: customFetch });
    const openai = new OpenAIClient({ apiKey: 'k', model: 'm', fetch: customFetch });
    assert.equal(gemini.fetch, customFetch);
    assert.equal(openai.fetch, customFetch);
  });
});
