import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createLlmClient } from '../src/llm/registry.js';
import { GeminiClient } from '../src/llm/gemini.js';
import { OpenAIClient } from '../src/llm/openai.js';

describe('Step 3: LLM Client Registry', () => {
  test('dispatch gemini provider returns GeminiClient', () => {
    const client = createLlmClient({ provider: 'gemini', model: 'gemini-2.5-flash', apiKey: 'k' });
    assert.ok(client instanceof GeminiClient);
    assert.equal(client.getModel(), 'gemini-2.5-flash');
  });

  test('dispatch openai provider returns OpenAIClient', () => {
    const client = createLlmClient({ provider: 'openai', model: 'gpt-4o', apiKey: 'k', baseUrl: 'https://o.ai/v1' });
    assert.ok(client instanceof OpenAIClient);
    assert.equal(client.getModel(), 'gpt-4o');
    assert.equal(client.baseUrl, 'https://o.ai/v1');
  });

  test('unknown provider throws', () => {
    assert.throws(() => createLlmClient({ provider: 'foo', apiKey: 'k' }), /Unknown provider/);
  });
});
