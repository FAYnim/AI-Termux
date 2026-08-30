import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseArgs } from '../src/cli/args.js';
import { BUILTIN_PROVIDERS } from '../src/config/constants.js';
import { GeminiClient } from '../src/llm/gemini.js';
import { OpenAIClient } from '../src/llm/openai.js';
import { createLlmClient } from '../src/llm/registry.js';

describe('Phase 4 — OpenAI-Compatible Adapter Clarity & Routing', () => {
  // 4.3 Metadata adapter in constants.js
  describe('Phase 4.3 — BUILTIN_PROVIDERS adapter metadata', () => {
    test('BUILTIN_PROVIDERS.gemini has adapter: "gemini"', () => {
      assert.equal(BUILTIN_PROVIDERS.gemini.adapter, 'gemini');
    });

    test('BUILTIN_PROVIDERS.openai has adapter: "openai"', () => {
      assert.equal(BUILTIN_PROVIDERS.openai.adapter, 'openai');
    });

    test('all builtin providers have valid adapter metadata ("gemini" | "openai")', () => {
      for (const [id, def] of Object.entries(BUILTIN_PROVIDERS)) {
        assert.ok(
          def.adapter === 'gemini' || def.adapter === 'openai',
          `BUILTIN_PROVIDERS.${id}.adapter must be 'gemini' or 'openai', got: "${def.adapter}"`,
        );
      }
    });
  });

  // 4.2 Registry routing
  describe('Phase 4.2 — createLlmClient routing', () => {
    test('routes gemini provider to GeminiClient', () => {
      const client = createLlmClient({
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        apiKey: 'test-key',
      });
      assert.ok(client instanceof GeminiClient);
      assert.equal(client.getModel(), 'gemini-2.5-flash');
    });

    test('routes openai provider to OpenAIClient', () => {
      const client = createLlmClient({
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'test-key',
        baseUrl: 'https://api.openai.com/v1',
      });
      assert.ok(client instanceof OpenAIClient);
      assert.equal(client.getModel(), 'gpt-4o');
      assert.equal(client.baseUrl, 'https://api.openai.com/v1');
    });

    test('routes custom OpenAI-compatible provider with baseUrl to OpenAIClient', () => {
      const client = createLlmClient({
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
        apiKey: 'gsk_test',
        baseUrl: 'https://api.groq.com/openai/v1',
      });
      assert.ok(client instanceof OpenAIClient);
      assert.equal(client.getModel(), 'llama-3.3-70b-versatile');
      assert.equal(client.baseUrl, 'https://api.groq.com/openai/v1');
      assert.equal(client.getApiKey(), 'gsk_test');
    });

    test('routes custom provider with adapter: "openai" to OpenAIClient', () => {
      const client = createLlmClient({
        provider: 'custom-endpoint',
        adapter: 'openai',
        model: 'my-custom-model',
        apiKey: 'sk-custom',
        baseUrl: 'http://localhost:11434/v1',
      });
      assert.ok(client instanceof OpenAIClient);
      assert.equal(client.getModel(), 'my-custom-model');
      assert.equal(client.baseUrl, 'http://localhost:11434/v1');
    });

    test('throws descriptive error for unknown provider without baseUrl or adapter', () => {
      assert.throws(
        () => createLlmClient({ provider: 'unsupported-llm', apiKey: 'k' }),
        /Unknown provider: unsupported-llm/,
      );
    });
  });

  // CLI argument parsing for --adapter
  describe('Phase 4.1 / CLI — parseArgs --adapter option', () => {
    test('parses --adapter <type> flag', () => {
      const parsed = parseArgs([
        'provider',
        'add',
        'groq',
        '--adapter',
        'openai',
        '--base-url',
        'https://api.groq.com',
      ]);
      assert.equal(parsed.flags.adapter, 'openai');
      assert.equal(parsed.flags.baseUrl, 'https://api.groq.com');
      assert.equal(parsed.args[0], 'groq');
    });

    test('parses --adapter=<type> flag', () => {
      const parsed = parseArgs(['provider', 'add', 'deepseek', '--adapter=openai']);
      assert.equal(parsed.flags.adapter, 'openai');
      assert.equal(parsed.args[0], 'deepseek');
    });

    test('flags.adapter defaults to null when not specified', () => {
      const parsed = parseArgs(['provider', 'add', 'ollama']);
      assert.equal(parsed.flags.adapter, null);
    });
  });
});
