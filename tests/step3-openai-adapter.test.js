import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIClient } from '../src/llm/openai.js';

describe('Step 3: OpenAI Adapter', () => {
  function makeFetcher(chunks) {
    return async function fetch(url, init) {
      const body = JSON.parse(init?.body || '{}');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }
        }),
        body: createReadableStream(chunks),
      };
    };
    function createReadableStream(items) {
      return new ReadableStream({
        start(controller) {
          for (const item of items) controller.enqueue(new TextEncoder().encode(item));
          controller.close();
        },
      });
    }
  }

  test('non-stream text returns text + finishReason STOP', async () => {
    const client = new OpenAIClient({ apiKey: 'k', model: 'gpt-4o', fetch: makeFetcher([]) });
    // Non-stream returns raw JSON
    const result = await client.generate({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] });
    assert.equal(result.text, '');
    assert.equal(result.finishReason, 'STOP');
  });

  test('streaming text deltas emitted via onToken', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"world!"},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const client = new OpenAIClient({ apiKey: 'k', model: 'gpt-4o', fetch: makeFetcher(chunks) });
    const tokens = [];
    const result = await client.generateStream({
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      onToken: t => tokens.push(t),
    });
    assert.deepEqual(tokens, ['Hello ', 'world!']);
    assert.equal(result.text, 'Hello world!');
    assert.equal(result.finishReason, 'STOP');
  });

  test('tool_calls across multiple chunks assembled into single call', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"read_file"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\"x.txt\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const client = new OpenAIClient({ apiKey: 'k', model: 'gpt-4o', fetch: makeFetcher(chunks) });
    const calls = [];
    const result = await client.generateStream({
      contents: [{ role: 'user', parts: [{ text: 'read x' }] }],
      onFunctionCall: fc => calls.push(fc),
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'read_file');
    assert.deepEqual(calls[0].args, { path: 'x.txt' });
    assert.equal(result.finishReason, 'STOP'); // mapped from tool_calls
  });

  test('mixed text + tool_calls yields both', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"doing "}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"exec","arguments":"{\\"c\\":\\"ls\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const client = new OpenAIClient({ apiKey: 'k', model: 'gpt-4o', fetch: makeFetcher(chunks) });
    const tokens = [];
    const calls = [];
    const result = await client.generateStream({
      contents: [{ role: 'user', parts: [{ text: 'do it' }] }],
      onToken: t => tokens.push(t),
      onFunctionCall: fc => calls.push(fc),
    });
    assert.equal(result.text, 'doing ');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'exec');
    assert.deepEqual(calls[0].args, { c: 'ls' });
  });

  test('finish_reason mapping', async () => {
    const cases = [
      ['stop', 'STOP'],
      ['length', 'MAX_TOKENS'],
      ['tool_calls', 'STOP'],
      [null, null],
    ];
    for (const [reason, expected] of cases) {
      const clamped = reason === null ? {} : {'finish_reason': reason};
      const chunk = `data: {"choices":[{"delta":${JSON.stringify(clamped)}}]}\n\n`;
      const client = new OpenAIClient({ apiKey: 'k', model: 'gpt-4o', fetch: makeFetcher([chunk, 'data: [DONE]\n\n']) });
      const r = await client.generateStream({
        contents: [{ role: 'user', parts: [{ text: 'x' }] }],
      });
      assert.equal(r.finishReason, expected, `expected ${expected} for reason ${reason}`);
    }
  });

  test('non-200 response throws typed error with status/details', async () => {
    const client = new OpenAIClient({
      apiKey: 'k',
      model: 'gpt-4o',
      fetch: async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'bad key' } }),
        text: async () => '{"error":{"message":"bad key"}}',
      }),
    });
    let err;
    try {
      await client.generate({ contents: 'hi' });
    } catch (e) { err = e; }
    assert.ok(err);
    assert.match(err.message, /401/);
    assert.equal(err.status, 401);
    assert.equal(err.statusCode, 401);
    assert.ok(err.details);
  });

  test('empty choices yields empty text and STOP', async () => {
    const client = new OpenAIClient({ apiKey: 'k', model: 'gpt-4o', fetch: makeFetcher(['data: {"choices":[]}\n\ndata: [DONE]\n\n']) });
    const r = await client.generateStream({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] });
    assert.equal(r.text, '');
    assert.equal(r.functionCalls.length, 0);
    assert.equal(r.finishReason, 'STOP');
  });
});
