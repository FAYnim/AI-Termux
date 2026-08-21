/**
 * Unit Tests: Retry Engine, Exponential Backoff & GeminiClient
 * Step 3: LLM Client & Network Resilience
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  withRetry,
  isRetryableError,
  calculateBackoffDelay,
  sleep
} from '../src/llm/retry.js';
import {
  GeminiClient,
  createGeminiClient
} from '../src/llm/gemini.js';
import {
  createUserMessage,
  createModelMessage,
  createFunctionCallPart,
  createFunctionResponseMessage,
  createSystemInstruction,
  formatTools,
  normalizeContent
} from '../src/llm/types.js';

describe('Step 3: Message Types & Serialization', () => {
  test('should create valid User message', () => {
    const msg = createUserMessage('Halo Gemini');
    assert.deepEqual(msg, {
      role: 'user',
      parts: [{ text: 'Halo Gemini' }]
    });
  });

  test('should create valid Model message', () => {
    const msg = createModelMessage('Halo! Saya AI');
    assert.deepEqual(msg, {
      role: 'model',
      parts: [{ text: 'Halo! Saya AI' }]
    });
  });

  test('should create Function Call part', () => {
    const part = createFunctionCallPart('read_file', { filePath: 'foo.txt' });
    assert.deepEqual(part, {
      functionCall: {
        name: 'read_file',
        args: { filePath: 'foo.txt' }
      }
    });
  });

  test('should create Function Response message', () => {
    const msg = createFunctionResponseMessage('read_file', { content: 'File contents here' });
    assert.deepEqual(msg, {
      role: 'function',
      parts: [
        {
          functionResponse: {
            name: 'read_file',
            response: { content: 'File contents here' }
          }
        }
      ]
    });
  });

  test('should format System Instruction properly', () => {
    const sys = createSystemInstruction('You are Termux AI Agent');
    assert.deepEqual(sys, {
      parts: [{ text: 'You are Termux AI Agent' }]
    });
  });

  test('should format tools list into Gemini functionDeclarations format', () => {
    const tools = [
      {
        name: 'execute_command',
        description: 'Run shell command',
        parameters: { type: 'OBJECT', properties: {} }
      }
    ];

    const formatted = formatTools(tools);
    assert.deepEqual(formatted, [
      {
        functionDeclarations: tools
      }
    ]);
  });

  test('should normalize content objects and strings', () => {
    const strContent = normalizeContent('Simple query');
    assert.equal(strContent.role, 'user');
    assert.deepEqual(strContent.parts, [{ text: 'Simple query' }]);

    const objContent = normalizeContent({
      role: 'model',
      text: 'Response text'
    });
    assert.equal(objContent.role, 'model');
    assert.deepEqual(objContent.parts, [{ text: 'Response text' }]);
  });
});

describe('Step 3: Network Resilience & Retry Logic', () => {
  test('calculateBackoffDelay should increase exponentially and respect cap', () => {
    const delay0 = calculateBackoffDelay(0, { initialDelayMs: 100, maxDelayMs: 1000, jitterMs: 0 });
    const delay1 = calculateBackoffDelay(1, { initialDelayMs: 100, maxDelayMs: 1000, jitterMs: 0 });
    const delay2 = calculateBackoffDelay(2, { initialDelayMs: 100, maxDelayMs: 1000, jitterMs: 0 });
    const delayCapped = calculateBackoffDelay(5, { initialDelayMs: 100, maxDelayMs: 500, jitterMs: 0 });

    assert.equal(delay0, 100);
    assert.equal(delay1, 200);
    assert.equal(delay2, 400);
    assert.equal(delayCapped, 500);
  });

  test('isRetryableError should correctly identify transient vs fatal errors', () => {
    // Retryable HTTP statuses
    assert.equal(isRetryableError({ status: 429 }), true);
    assert.equal(isRetryableError({ status: 503 }), true);

    // Retryable Node.js network error codes
    assert.equal(isRetryableError({ code: 'ECONNRESET' }), true);
    assert.equal(isRetryableError({ code: 'ETIMEDOUT' }), true);
    assert.equal(isRetryableError({ code: 'ENOTFOUND' }), true);
    assert.equal(isRetryableError({ code: 'UND_ERR_CONNECT_TIMEOUT' }), true);

    // Retryable message signatures
    assert.equal(isRetryableError(new TypeError('fetch failed')), true);
    assert.equal(isRetryableError(new Error('Rate limit exceeded')), true);

    // Non-retryable errors
    assert.equal(isRetryableError({ status: 400 }), false);
    assert.equal(isRetryableError({ status: 401 }), false);
    assert.equal(isRetryableError({ status: 403 }), false);
    assert.equal(isRetryableError({ status: 404 }), false);
    assert.equal(isRetryableError(new Error('Invalid JSON syntax')), false);

    // Abort errors
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    assert.equal(isRetryableError(abortErr), false);
  });

  test('sleep should resolve after delay and reject when aborted', async () => {
    const start = Date.now();
    await sleep(20);
    assert.ok(Date.now() - start >= 15);

    const controller = new AbortController();
    controller.abort(new Error('Stop sleep'));

    await assert.rejects(
      async () => {
        await sleep(1000, controller.signal);
      },
      /Stop sleep/
    );
  });

  test('withRetry should succeed on first attempt if no error occurs', async () => {
    let callCount = 0;
    const result = await withRetry(async () => {
      callCount++;
      return 'success';
    });

    assert.equal(result, 'success');
    assert.equal(callCount, 1);
  });

  test('withRetry should recover and succeed after transient failures', async () => {
    let callCount = 0;
    const retryEvents = [];

    const result = await withRetry(
      async () => {
        callCount++;
        if (callCount < 3) {
          const err = new Error('Too Many Requests');
          err.status = 429;
          throw err;
        }
        return 'recovered';
      },
      {
        initialDelayMs: 10,
        jitterMs: 5,
        maxRetries: 3,
        onRetry: evt => retryEvents.push(evt)
      }
    );

    assert.equal(result, 'recovered');
    assert.equal(callCount, 3);
    assert.equal(retryEvents.length, 2);
    assert.equal(retryEvents[0].attempt, 1);
    assert.equal(retryEvents[1].attempt, 2);
  });

  test('withRetry should throw when maxRetries is exceeded', async () => {
    let callCount = 0;

    await assert.rejects(
      async () => {
        await withRetry(
          async () => {
            callCount++;
            const err = new Error('Service Unavailable');
            err.status = 503;
            throw err;
          },
          {
            initialDelayMs: 5,
            jitterMs: 2,
            maxRetries: 2
          }
        );
      },
      /Service Unavailable/
    );

    // Initial call + 2 retries = 3 calls
    assert.equal(callCount, 3);
  });

  test('withRetry should fail immediately on non-retryable error without retrying', async () => {
    let callCount = 0;

    await assert.rejects(
      async () => {
        await withRetry(
          async () => {
            callCount++;
            const err = new Error('Bad Request: Invalid model parameters');
            err.status = 400;
            throw err;
          },
          {
            initialDelayMs: 5,
            maxRetries: 3
          }
        );
      },
      /Bad Request/
    );

    assert.equal(callCount, 1);
  });

  test('withRetry should abort immediately when signal is triggered', async () => {
    const controller = new AbortController();

    await assert.rejects(
      async () => {
        await withRetry(
          async () => {
            controller.abort(new Error('Operation cancelled by user'));
            const err = new Error('Network error');
            err.code = 'ECONNRESET';
            throw err;
          },
          {
            initialDelayMs: 50,
            signal: controller.signal
          }
        );
      },
      /Operation cancelled by user/
    );
  });
});

describe('Step 3: Gemini API Client', () => {
  test('should initialize with defaults and allow model / apiKey switching', () => {
    const client = new GeminiClient({
      apiKey: 'test-key-123',
      model: 'gemini-2.5-flash'
    });

    assert.equal(client.getApiKey(), 'test-key-123');
    assert.equal(client.getModel(), 'gemini-2.5-flash');

    client.setModel('gemini-2.5-pro');
    assert.equal(client.getModel(), 'gemini-2.5-pro');

    client.setApiKey('updated-key-456');
    assert.equal(client.getApiKey(), 'updated-key-456');
  });

  test('should build proper endpoints for streaming and non-streaming', () => {
    const client = new GeminiClient({
      apiKey: 'my-api-key',
      model: 'gemini-2.5-flash',
      apiVersion: 'v1beta'
    });

    const streamEndpoint = client.getEndpoint('streamGenerateContent', true);
    const nonStreamEndpoint = client.getEndpoint('generateContent', false);

    assert.equal(
      streamEndpoint,
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=my-api-key'
    );
    assert.equal(
      nonStreamEndpoint,
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=my-api-key'
    );
  });

  test('should format request body correctly with prompt and tools', () => {
    const client = new GeminiClient({
      apiKey: 'test-key',
      systemInstruction: 'Default system prompt'
    });

    const body = client.buildRequestBody({
      contents: 'Tulis fungsi prima di math.js',
      tools: [{ name: 'write_file', description: 'Write file', parameters: { type: 'OBJECT', properties: {} } }],
      generationConfig: { temperature: 0.1 }
    });

    assert.equal(body.contents.length, 1);
    assert.equal(body.contents[0].role, 'user');
    assert.deepEqual(body.contents[0].parts, [{ text: 'Tulis fungsi prima di math.js' }]);

    assert.equal(body.tools.length, 1);
    assert.equal(body.tools[0].functionDeclarations[0].name, 'write_file');

    assert.deepEqual(body.systemInstruction, {
      parts: [{ text: 'Default system prompt' }]
    });

    assert.equal(body.generationConfig.temperature, 0.1);
  });

  test('should throw validation error when API key is missing', async () => {
    const client = new GeminiClient({ apiKey: '' });

    await assert.rejects(
      async () => {
        await client.generate({ contents: 'Test' });
      },
      /Gemini API key is not configured/
    );

    await assert.rejects(
      async () => {
        await client.generateStream({ contents: 'Test' });
      },
      /Gemini API key is not configured/
    );
  });

  test('generateStream should stream tokens and parse function calls via mocked fetch', async () => {
    const mockSSE =
      'data: {"candidates":[{"content":{"parts":[{"text":"Langkah 1: "}]}}]}\n\n' +
      'data: {"candidates":[{"content":{"parts":[{"text":"Membaca file\\n"},{"functionCall":{"name":"read_file","args":{"filePath":"index.js"}}}]},"finishReason":"STOP"}]}\n\n';

    const mockFetch = async () => {
      return {
        ok: true,
        status: 200,
        body: (async function* () {
          yield mockSSE;
        })()
      };
    };

    const client = createGeminiClient({
      apiKey: 'test-valid-key',
      fetch: mockFetch
    });

    const tokens = [];
    const calls = [];
    let finishReason = null;

    const result = await client.generateStream({
      contents: 'Baca index.js',
      onToken: t => tokens.push(t),
      onFunctionCall: fc => calls.push(fc),
      onFinish: fr => {
        finishReason = fr;
      }
    });

    assert.deepEqual(tokens, ['Langkah 1: ', 'Membaca file\n']);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'read_file');
    assert.deepEqual(calls[0].args, { filePath: 'index.js' });
    assert.equal(finishReason, 'STOP');

    assert.equal(result.text, 'Langkah 1: Membaca file\n');
    assert.equal(result.functionCalls.length, 1);
    assert.equal(result.finishReason, 'STOP');
  });

  test('generate (non-streaming) should return parsed response via mocked fetch', async () => {
    const mockResponse = {
      candidates: [
        {
          content: {
            parts: [
              { text: 'Kode berhasil dibuat.' },
              { functionCall: { name: 'write_file', args: { filePath: 'test.js', content: 'console.log(1);' } } }
            ]
          },
          finishReason: 'STOP'
        }
      ],
      usageMetadata: {
        promptTokenCount: 20,
        candidatesTokenCount: 15,
        totalTokenCount: 35
      }
    };

    const mockFetch = async () => {
      return {
        ok: true,
        status: 200,
        json: async () => mockResponse
      };
    };

    const client = new GeminiClient({
      apiKey: 'test-valid-key',
      fetch: mockFetch
    });

    const result = await client.generate({
      contents: 'Buat file test.js'
    });

    assert.equal(result.text, 'Kode berhasil dibuat.');
    assert.equal(result.functionCalls.length, 1);
    assert.equal(result.functionCalls[0].name, 'write_file');
    assert.equal(result.finishReason, 'STOP');
    assert.deepEqual(result.usage, {
      promptTokenCount: 20,
      candidatesTokenCount: 15,
      totalTokenCount: 35
    });
  });

  test('should handle and wrap API error responses cleanly', async () => {
    const mockFetch = async () => {
      return {
        ok: false,
        status: 403,
        json: async () => ({
          error: {
            code: 403,
            message: 'API key not valid. Please pass a valid API key.',
            status: 'PERMISSION_DENIED'
          }
        })
      };
    };

    const client = new GeminiClient({
      apiKey: 'invalid-key',
      fetch: mockFetch,
      retryOptions: { maxRetries: 0 }
    });

    await assert.rejects(
      async () => {
        await client.generate({ contents: 'Test query' });
      },
      /API key not valid/
    );
  });
});
