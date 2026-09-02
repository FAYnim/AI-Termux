/**
 * Regression Tests: Gemini thought_signature round-trip
 *
 * Gemini 3+ attaches a thoughtSignature to function call parts and rejects the
 * follow-up request with 400 ("Function call is missing a thought_signature in
 * functionCall parts") when the signature is not echoed back. These tests lock
 * the full round-trip: extraction -> session history -> request replay.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { AgentOrchestrator } from '../src/agent/orchestrator.js';
import { SessionManager } from '../src/agent/session.js';
import { GeminiClient } from '../src/llm/gemini.js';
import { SSEStreamParser } from '../src/llm/stream-parser.js';

describe('thought_signature extraction (stream)', () => {
  test('captures thoughtSignature from function call parts', () => {
    const parser = new SSEStreamParser({});

    parser.feed(
      'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"list_dir","args":{}},"thoughtSignature":"sig-abc"}]},"finishReason":"STOP"}]}\n\n',
    );
    parser.flush();

    const { functionCalls } = parser.getResult();
    assert.equal(functionCalls.length, 1);
    assert.equal(functionCalls[0].name, 'list_dir');
    assert.equal(functionCalls[0].thoughtSignature, 'sig-abc');
  });

  test('omits thoughtSignature when the part has none', () => {
    const parser = new SSEStreamParser({});

    parser.feed(
      'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"list_dir","args":{}}}]},"finishReason":"STOP"}]}\n\n',
    );
    parser.flush();

    const { functionCalls } = parser.getResult();
    assert.equal(functionCalls.length, 1);
    assert.equal('thoughtSignature' in functionCalls[0], false);
  });
});

describe('thought_signature extraction (non-stream)', () => {
  test('GeminiClient.generate captures thoughtSignature', async () => {
    const responseData = {
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: { name: 'read_file', args: { filePath: 'a.txt' } },
                thoughtSignature: 'sig-xyz',
              },
            ],
          },
          finishReason: 'STOP',
        },
      ],
    };
    const client = new GeminiClient({
      apiKey: 'test-key',
      model: 'gemini-3.5-flash',
      fetch: async () => ({
        ok: true,
        json: async () => responseData,
      }),
    });

    const result = await client.generate({ contents: 'hi' });
    assert.equal(result.functionCalls[0].thoughtSignature, 'sig-xyz');
  });
});

describe('thought_signature request replay', () => {
  test('buildRequestBody preserves part-level thoughtSignature', () => {
    const client = new GeminiClient({ apiKey: 'test-key', model: 'gemini-3.5-flash' });

    const payload = client.buildRequestBody({
      contents: [
        { role: 'user', parts: [{ text: 'tes' }] },
        {
          role: 'model',
          parts: [{ functionCall: { name: 'list_dir', args: {} }, thoughtSignature: 'sig-abc' }],
        },
        {
          role: 'user',
          parts: [{ functionResponse: { name: 'list_dir', response: { output: 'ok' } } }],
        },
      ],
    });

    const modelPart = payload.contents[1].parts[0];
    assert.deepEqual(modelPart.functionCall, { name: 'list_dir', args: {} });
    assert.equal(modelPart.thoughtSignature, 'sig-abc');
  });
});

describe('thought_signature end-to-end (orchestrator)', () => {
  let tempDir;
  let sessionManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faycli-thought-sig-test-'));
    sessionManager = new SessionManager({ sessionsDir: tempDir });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test('function call thought signature reaches session history and the next request', async () => {
    const generateStreamCalls = [];
    const mockClient = {
      getModel: () => 'gemini-3.5-flash',
      getApiKey: () => 'k',
      generateStream: async (options) => {
        generateStreamCalls.push(options);
        if (generateStreamCalls.length === 1) {
          return {
            text: '',
            functionCalls: [{ name: 'list_dir', args: {}, thoughtSignature: 'sig-123' }],
            finishReason: 'STOP',
          };
        }
        return { text: 'done', functionCalls: [], finishReason: 'STOP' };
      },
    };

    const session = sessionManager.createSession({ workingDir: tempDir });
    const orchestrator = new AgentOrchestrator({
      llmClient: mockClient,
      session,
      workingDir: tempDir,
    });

    const result = await orchestrator.runTurn('tes');
    assert.equal(result.success, true);

    // Session history: the model message part carries the signature
    const messages = session.getMessages();
    const modelMsg = messages.find((m) => m.role === 'model');
    const fcPart = modelMsg.parts.find((p) => p.functionCall);
    assert.deepEqual(fcPart.functionCall, { name: 'list_dir', args: {} });
    assert.equal(fcPart.thoughtSignature, 'sig-123');

    // Replay: the second generation request contains the signed part
    assert.equal(generateStreamCalls.length, 2);
    const replayed = generateStreamCalls[1].contents;
    const replayedModelMsg = replayed.find((m) => m.role === 'model');
    const replayedPart = replayedModelMsg.parts.find((p) => p.functionCall);
    assert.equal(replayedPart.thoughtSignature, 'sig-123');
  });
});
