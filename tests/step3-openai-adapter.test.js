import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { OpenAIClient } from '../src/llm/openai.js';

describe('Step 3: OpenAI Adapter', () => {
  function makeFetcher(chunks) {
    return async function fetch(_url, init) {
      const _body = JSON.parse(init?.body || '{}');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
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
      onToken: (t) => tokens.push(t),
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
      onFunctionCall: (fc) => calls.push(fc),
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
      onToken: (t) => tokens.push(t),
      onFunctionCall: (fc) => calls.push(fc),
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
      const clamped = reason === null ? {} : { finish_reason: reason };
      const chunk = `data: {"choices":[{"delta":${JSON.stringify(clamped)}}]}\n\n`;
      const client = new OpenAIClient({
        apiKey: 'k',
        model: 'gpt-4o',
        fetch: makeFetcher([chunk, 'data: [DONE]\n\n']),
      });
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
    } catch (e) {
      err = e;
    }
    assert.ok(err);
    assert.match(err.message, /401/);
    assert.equal(err.status, 401);
    assert.equal(err.statusCode, 401);
    assert.ok(err.details);
  });

  test('empty choices yields empty text and STOP', async () => {
    const client = new OpenAIClient({
      apiKey: 'k',
      model: 'gpt-4o',
      fetch: makeFetcher(['data: {"choices":[]}\n\ndata: [DONE]\n\n']),
    });
    const r = await client.generateStream({
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
    });
    assert.equal(r.text, '');
    assert.equal(r.functionCalls.length, 0);
    assert.equal(r.finishReason, 'STOP');
  });
});

describe('Step 3: OpenAI Adapter Streaming Usage', () => {
  function createReadableStream(items) {
    return new ReadableStream({
      start(controller) {
        for (const item of items) controller.enqueue(new TextEncoder().encode(item));
        controller.close();
      },
    });
  }

  test('usage parsed from the terminal empty-choices chunk', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
      'data: [DONE]\n\n',
    ];
    // makeFetcher is scoped inside the first describe, so this suite uses a
    // local equivalent mock.
    const fetchMock = async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      body: createReadableStream(chunks),
    });
    const client = new OpenAIClient({ apiKey: 'k', model: 'gpt-4o', fetch: fetchMock });
    const result = await client.generateStream({
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
    });
    assert.deepEqual(result.usage, {
      promptTokenCount: 10,
      candidatesTokenCount: 5,
      totalTokenCount: 15,
    });
  });

  test('request body includes stream_options.include_usage', async () => {
    const bodies = [];
    const fetchMock = async (_url, init) => {
      bodies.push(JSON.parse(init?.body || '{}'));
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        body: createReadableStream(['data: [DONE]\n\n']),
      };
    };
    const client = new OpenAIClient({ apiKey: 'k', model: 'gpt-4o', fetch: fetchMock });
    await client.generateStream({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] });
    assert.deepEqual(bodies[0].stream_options, { include_usage: true });
  });

  test('400 with stream_options retries once without it and succeeds', async () => {
    const bodies = [];
    let call = 0;
    const fetchMock = async (_url, init) => {
      call++;
      bodies.push(JSON.parse(init?.body || '{}'));
      if (call === 1) {
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: { message: 'stream_options is not supported' } }),
          body: createReadableStream([]),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        body: createReadableStream([
          'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      };
    };
    const client = new OpenAIClient({ apiKey: 'k', model: 'gpt-4o', fetch: fetchMock });
    const result = await client.generateStream({
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
    });
    assert.equal(call, 2);
    assert.deepEqual(bodies[0].stream_options, { include_usage: true });
    assert.equal(bodies[1].stream_options, undefined);
    assert.equal(result.text, 'ok');
  });

  test('400 twice surfaces the ORIGINAL error and does not loop', async () => {
    let call = 0;
    const fetchMock = async () => {
      call++;
      // Capture the call number now: the response's json() must keep reporting
      // the error it was created with, so the ORIGINAL response's error ("bad
      // 1") is distinguishable from the retry's ("bad 2").
      const n = call;
      return {
        ok: false,
        status: 400,
        json: async () => ({ error: { message: `bad ${n}` } }),
        body: createReadableStream([]),
      };
    };
    const client = new OpenAIClient({ apiKey: 'k', model: 'gpt-4o', fetch: fetchMock });
    await assert.rejects(
      () => client.generateStream({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }),
      /OpenAI API Error \(400\): bad 1/,
    );
    assert.equal(call, 2);
  });
});
