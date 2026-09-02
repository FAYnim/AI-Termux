/**
 * Unit Tests: SSE Stream Parser & Fragmented Chunk Processing
 * Step 3: LLM Client & SSE Streaming
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createLlmClient } from '../src/llm/registry.js';
import { parseSSEStream, SSEStreamParser } from '../src/llm/stream-parser.js';

describe('Step 3: SSE Stream Parser', () => {
  test('should parse normal single chunk stream with text tokens', () => {
    const tokens = [];
    let finish = null;

    const parser = new SSEStreamParser({
      onToken: (t) => tokens.push(t),
      onFinish: (r) => {
        finish = r;
      },
    });

    const sseChunk =
      'data: {"candidates":[{"content":{"parts":[{"text":"Hello "}]}}]}\n\n' +
      'data: {"candidates":[{"content":{"parts":[{"text":"world!"}]},"finishReason":"STOP"}]}\n\n';

    parser.feed(sseChunk);
    parser.flush();

    assert.deepEqual(tokens, ['Hello ', 'world!']);
    assert.equal(finish, 'STOP');

    const result = parser.getResult();
    assert.equal(result.text, 'Hello world!');
    assert.equal(result.finishReason, 'STOP');
  });

  test('should handle fragmented chunks split across network packets', () => {
    const tokens = [];
    const parser = new SSEStreamParser({
      onToken: (t) => tokens.push(t),
    });

    // Simulating packets split arbitrarily
    const packet1 = 'data: {"candidates":[{"content":{"parts":[{"text":"Halo ';
    const packet2 = 'Termux"}]}}]}\n\ndata: {"candidates":[{"content":{"parts":';
    const packet3 = '[{"text":" AI!"}]},"finishReason":"STOP"}]}\n\n';

    parser.feed(packet1);
    assert.equal(tokens.length, 0); // Not completed yet

    parser.feed(packet2);
    assert.deepEqual(tokens, ['Halo Termux']);

    parser.feed(packet3);
    parser.flush();

    assert.deepEqual(tokens, ['Halo Termux', ' AI!']);
    assert.equal(parser.getResult().text, 'Halo Termux AI!');
    assert.equal(parser.getResult().finishReason, 'STOP');
  });

  test('should correctly parse function calls from SSE chunks', () => {
    const functionCalls = [];
    const parser = new SSEStreamParser({
      onFunctionCall: (fc) => functionCalls.push(fc),
    });

    const sseData =
      'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"read_file","args":{"filePath":"src/main.js"}}}]},"finishReason":"STOP"}]}\n\n';

    parser.feed(sseData);
    parser.flush();

    assert.equal(functionCalls.length, 1);
    assert.equal(functionCalls[0].name, 'read_file');
    assert.deepEqual(functionCalls[0].args, { filePath: 'src/main.js' });

    const result = parser.getResult();
    assert.equal(result.functionCalls.length, 1);
    assert.equal(result.functionCalls[0].name, 'read_file');
  });

  test('should handle dual output: text tokens followed by function calls', () => {
    const tokens = [];
    const functionCalls = [];

    const parser = new SSEStreamParser({
      onToken: (t) => tokens.push(t),
      onFunctionCall: (fc) => functionCalls.push(fc),
    });

    const sseData =
      'data: {"candidates":[{"content":{"parts":[{"text":"Saya akan memeriksa file konfigurasi."},{"functionCall":{"name":"read_file","args":{"filePath":".faycli/config.json"}}}]},"finishReason":"STOP"}]}\n\n';

    parser.feed(sseData);
    parser.flush();

    assert.deepEqual(tokens, ['Saya akan memeriksa file konfigurasi.']);
    assert.equal(functionCalls.length, 1);
    assert.equal(functionCalls[0].name, 'read_file');
    assert.deepEqual(functionCalls[0].args, { filePath: '.faycli/config.json' });

    const result = parser.getResult();
    assert.equal(result.text, 'Saya akan memeriksa file konfigurasi.');
    assert.equal(result.functionCalls.length, 1);
  });

  test('should capture usageMetadata token counts', () => {
    const parser = new SSEStreamParser();

    const sseData =
      'data: {"candidates":[{"content":{"parts":[{"text":"OK"}]}}],"usageMetadata":{"promptTokenCount":45,"candidatesTokenCount":12,"totalTokenCount":57}}\n\n';

    parser.feed(sseData);
    parser.flush();

    const result = parser.getResult();
    assert.deepEqual(result.usage, {
      promptTokenCount: 45,
      candidatesTokenCount: 12,
      totalTokenCount: 57,
    });
  });

  test('should ignore SSE comments and empty lines', () => {
    const tokens = [];
    const parser = new SSEStreamParser({
      onToken: (t) => tokens.push(t),
    });

    const sseData =
      ': ping\n\n' +
      ': keepalive\n' +
      '\n' +
      'data: {"candidates":[{"content":{"parts":[{"text":"Alive"}]}}]}\n\n' +
      ': trailing comment\n';

    parser.feed(sseData);
    parser.flush();

    assert.deepEqual(tokens, ['Alive']);
    assert.equal(parser.getResult().text, 'Alive');
  });

  test('should handle [DONE] SSE termination marker', () => {
    const parser = new SSEStreamParser();

    parser.feed('data: {"candidates":[{"content":{"parts":[{"text":"Selesai"}]}}]}\n\n');
    parser.feed('data: [DONE]\n\n');
    parser.flush();

    assert.equal(parser.isDone, true);
    assert.equal(parser.getResult().text, 'Selesai');
  });

  test('should parse Uint8Array and Buffer chunks directly', () => {
    const tokens = [];
    const parser = new SSEStreamParser({
      onToken: (t) => tokens.push(t),
    });

    const encoder = new TextEncoder();
    const uint8 = encoder.encode(
      'data: {"candidates":[{"content":{"parts":[{"text":"Binary chunk"}]}}]}\n\n',
    );

    parser.feed(uint8);
    parser.flush();

    assert.deepEqual(tokens, ['Binary chunk']);
  });

  test('should handle multibyte UTF-8 characters split across chunk boundaries', () => {
    const tokens = [];
    const parser = new SSEStreamParser({
      onToken: (t) => tokens.push(t),
    });

    // Character: '⚡' (3 bytes: 0xE2, 0x9A, 0xA1)
    const jsonPrefix = 'data: {"candidates":[{"content":{"parts":[{"text":"Icon: ';
    const jsonSuffix = '"}]}}]}\n\n';

    const encoder = new TextEncoder();
    const prefixBytes = encoder.encode(jsonPrefix);
    const suffixBytes = encoder.encode(jsonSuffix);
    const iconBytes = encoder.encode('⚡');

    // Split icon bytes across two packets
    const part1 = new Uint8Array([...prefixBytes, iconBytes[0]]);
    const part2 = new Uint8Array([iconBytes[1], iconBytes[2], ...suffixBytes]);

    parser.feed(part1);
    parser.feed(part2);
    parser.flush();

    assert.equal(parser.getResult().text, 'Icon: ⚡');
  });

  test('should propagate API error payload inside SSE stream', () => {
    const errors = [];
    const parser = new SSEStreamParser({
      onError: (err) => errors.push(err),
    });

    const errorData =
      'data: {"error":{"code":400,"message":"Invalid argument provided","status":"INVALID_ARGUMENT"}}\n\n';

    parser.feed(errorData);
    parser.flush();

    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /Invalid argument provided/);
    assert.equal(errors[0].code, 400);
  });

  test('parseSSEStream async generator should process async iterable', async () => {
    async function* makeChunks() {
      yield 'data: {"candidates":[{"content":{"parts":[{"text":"First "}]}}]}\n\n';
      yield 'data: {"candidates":[{"content":{"parts":[{"text":"Second"}]},"finishReason":"STOP"}]}\n\n';
    }

    const result = await parseSSEStream(makeChunks());
    assert.equal(result.text, 'First Second');
    assert.equal(result.finishReason, 'STOP');
  });

  test('parseSSEStream should respect AbortSignal', async () => {
    const controller = new AbortController();

    async function* makeInfiniteChunks() {
      yield 'data: {"candidates":[{"content":{"parts":[{"text":"Token 1"}]}}]}\n\n';
      controller.abort(new Error('User cancelled'));
      yield 'data: {"candidates":[{"content":{"parts":[{"text":"Token 2"}]}}]}\n\n';
    }

    await assert.rejects(async () => {
      await parseSSEStream(makeInfiniteChunks(), { signal: controller.signal });
    }, /User cancelled/);
  });

  test('registry e2e: OpenAI SSE stream text', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hi "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"there!"},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const fetch = async () => ({
      ok: true,
      body: new ReadableStream({
        start(ctrl) {
          for (const c of chunks) ctrl.enqueue(new TextEncoder().encode(c));
          ctrl.close();
        },
      }),
    });
    const client = createLlmClient({ provider: 'openai', model: 'gpt-4o', apiKey: 'k', fetch });
    const result = await client.generateStream({
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
    });
    assert.equal(result.text, 'Hi there!');
    assert.equal(result.finishReason, 'STOP');
  });
});
