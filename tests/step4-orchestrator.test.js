/**
 * Integration & Unit Tests: Core ReAct Agent Orchestrator
 * Step 4: ReAct Agentic Loop & Conversation State Engine
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { AgentOrchestrator } from '../src/agent/orchestrator.js';
import { SessionManager } from '../src/agent/session.js';

describe('Step 4: ReAct Agent Orchestrator', () => {
  let tempDir;
  let sessionManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'termuxai-orchestrator-test-'));
    sessionManager = new SessionManager({ sessionsDir: tempDir });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test('should execute single-turn plain text answer without tool calls', async () => {
    const mockGemini = {
      getModel: () => 'gemini-2.5-flash',
      generateStream: async () => ({
        text: 'Halo! Saya asisten termuxai siap membantu Anda di Termux.',
        functionCalls: [],
        finishReason: 'STOP',
      }),
    };

    const session = sessionManager.createSession({ workingDir: tempDir });
    const orchestrator = new AgentOrchestrator({
      llmClient: mockGemini,
      session,
      workingDir: tempDir,
    });

    const tokens = [];
    const result = await orchestrator.runTurn('Halo siapa kamu?', {
      onToken: (t) => tokens.push(t),
    });

    assert.equal(result.success, true);
    assert.equal(result.iterations, 1);
    assert.equal(result.toolCalls.length, 0);
    assert.equal(result.text, 'Halo! Saya asisten termuxai siap membantu Anda di Termux.');

    // Verify session contains user and model message
    const messages = session.getMessages();
    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, 'user');
    assert.equal(messages[0].parts[0].text, 'Halo siapa kamu?');
    assert.equal(messages[1].role, 'model');
    assert.equal(
      messages[1].parts[0].text,
      'Halo! Saya asisten termuxai siap membantu Anda di Termux.',
    );
  });

  test('should execute single tool call (read_file) and continue to final response', async () => {
    // Create test file in workspace
    const testFile = path.join(tempDir, 'hello.txt');
    fs.writeFileSync(testFile, 'Content from file!', 'utf8');

    let callCount = 0;
    const mockGemini = {
      getModel: () => 'gemini-2.5-flash',
      generateStream: async () => {
        callCount++;
        if (callCount === 1) {
          // Model decides to read the file
          return {
            text: 'Saya akan membaca file hello.txt terlebih dahulu.',
            functionCalls: [
              {
                name: 'read_file',
                args: { filePath: 'hello.txt' },
              },
            ],
            finishReason: 'STOP',
          };
        } else {
          // Model analyzes tool response and answers
          return {
            text: 'Isi file hello.txt adalah: Content from file!',
            functionCalls: [],
            finishReason: 'STOP',
          };
        }
      },
    };

    const session = sessionManager.createSession({ workingDir: tempDir });
    const orchestrator = new AgentOrchestrator({
      llmClient: mockGemini,
      session,
      workingDir: tempDir,
      autoApprove: true,
    });

    const toolEvents = [];
    const result = await orchestrator.runTurn('Baca isi file hello.txt', {
      onToolCall: (fc) => toolEvents.push({ event: 'start', name: fc.name }),
      onToolResult: (name, res) => toolEvents.push({ event: 'end', name, res }),
    });

    assert.equal(result.success, true);
    assert.equal(result.iterations, 2);
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].name, 'read_file');
    assert.equal(result.toolCalls[0].response.content, 'Content from file!');
    assert.equal(result.text, 'Isi file hello.txt adalah: Content from file!');

    assert.equal(toolEvents.length, 2);
    assert.equal(toolEvents[0].event, 'start');
    assert.equal(toolEvents[1].event, 'end');

    // Verify session history integrity: user -> model (with tool call) -> function -> model
    const msgs = session.getMessages();
    assert.equal(msgs.length, 4);
    assert.equal(msgs[0].role, 'user');
    assert.equal(msgs[1].role, 'model');
    assert.ok(msgs[1].parts.some((p) => p.functionCall));
    assert.equal(msgs[2].role, 'function');
    assert.equal(msgs[2].parts[0].functionResponse.name, 'read_file');
    assert.equal(msgs[3].role, 'model');
    assert.equal(msgs[3].parts[0].text, 'Isi file hello.txt adalah: Content from file!');
  });

  test('should support multi-step tool execution chain (write_file -> read_file -> answer)', async () => {
    let callCount = 0;
    const mockGemini = {
      getModel: () => 'gemini-2.5-flash',
      generateStream: async () => {
        callCount++;
        if (callCount === 1) {
          return {
            text: 'Menulis file app.js...',
            functionCalls: [
              {
                name: 'write_file',
                args: { filePath: 'app.js', content: 'console.log("App ready");' },
              },
            ],
          };
        } else if (callCount === 2) {
          return {
            text: 'Membaca kembali app.js...',
            functionCalls: [{ name: 'read_file', args: { filePath: 'app.js' } }],
          };
        } else {
          return {
            text: 'File app.js berhasil dibuat dan diverifikasi!',
            functionCalls: [],
          };
        }
      },
    };

    const session = sessionManager.createSession({ workingDir: tempDir });
    const orchestrator = new AgentOrchestrator({
      llmClient: mockGemini,
      session,
      workingDir: tempDir,
      autoApprove: true,
    });

    const result = await orchestrator.runTurn('Buat dan verifikasi app.js');

    assert.equal(result.success, true);
    assert.equal(result.iterations, 3);
    assert.equal(result.toolCalls.length, 2);
    assert.equal(result.toolCalls[0].name, 'write_file');
    assert.equal(result.toolCalls[1].name, 'read_file');
    assert.equal(result.text, 'File app.js berhasil dibuat dan diverifikasi!');

    // Check that app.js was actually written to disk
    const createdContent = fs.readFileSync(path.join(tempDir, 'app.js'), 'utf8');
    assert.equal(createdContent, 'console.log("App ready");');
  });

  test('should handle tool execution error with self-correction feedback loop', async () => {
    let callCount = 0;
    const mockGemini = {
      getModel: () => 'gemini-2.5-flash',
      generateStream: async ({ contents }) => {
        callCount++;
        if (callCount === 1) {
          // Model tries to read non-existent file
          return {
            text: 'Mencoba membaca config.json',
            functionCalls: [{ name: 'read_file', args: { filePath: 'non_existent.json' } }],
          };
        } else if (callCount === 2) {
          // Verify model receives error payload in history
          const lastMsg = contents[contents.length - 1];
          assert.equal(lastMsg.role, 'function');
          assert.equal(lastMsg.parts[0].functionResponse.response.error, true);

          // Model corrects by creating the file instead
          return {
            text: 'File tidak ditemukan, saya akan membuatnya.',
            functionCalls: [
              { name: 'write_file', args: { filePath: 'config.json', content: '{"port":3000}' } },
            ],
          };
        } else {
          return {
            text: 'Konfigurasi default berhasil dibuat!',
            functionCalls: [],
          };
        }
      },
    };

    const session = sessionManager.createSession({ workingDir: tempDir });
    const orchestrator = new AgentOrchestrator({
      llmClient: mockGemini,
      session,
      workingDir: tempDir,
      autoApprove: true,
    });

    const result = await orchestrator.runTurn('Baca config atau buat baru jika tidak ada');

    assert.equal(result.success, true);
    assert.equal(result.iterations, 3);
    assert.equal(result.toolCalls.length, 2);
    assert.equal(result.toolCalls[0].response.error, true);
    assert.equal(result.toolCalls[1].name, 'write_file');
    assert.equal(result.text, 'Konfigurasi default berhasil dibuat!');
  });

  test('should handle security block and inject feedback to LLM', async () => {
    let callCount = 0;
    const mockGemini = {
      getModel: () => 'gemini-2.5-flash',
      generateStream: async () => {
        callCount++;
        if (callCount === 1) {
          // Model attempts dangerous blacklisted command
          return {
            text: 'Menghapus file berbahaya',
            functionCalls: [{ name: 'execute_command', args: { command: 'rm -rf /' } }],
          };
        } else {
          return {
            text: 'Perintah diblokir oleh sistem keamanan demi keselamatan.',
            functionCalls: [],
          };
        }
      },
    };

    const session = sessionManager.createSession({ workingDir: tempDir });
    const orchestrator = new AgentOrchestrator({
      llmClient: mockGemini,
      session,
      workingDir: tempDir,
    });

    const result = await orchestrator.runTurn('Jalankan pembersihan sistem');

    assert.equal(result.success, true);
    assert.equal(result.iterations, 2);
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].response.error, true);
    assert.ok(result.toolCalls[0].response.message.includes('Forbidden command'));
  });

  test('should enforce maxIterations limit to prevent infinite loops', async () => {
    // Model keeps calling tool indefinitely
    const mockGemini = {
      getModel: () => 'gemini-2.5-flash',
      generateStream: async () => ({
        text: 'Memeriksa direktori lagi...',
        functionCalls: [{ name: 'list_dir', args: { dirPath: '.' } }],
      }),
    };

    const session = sessionManager.createSession({ workingDir: tempDir });
    const orchestrator = new AgentOrchestrator({
      llmClient: mockGemini,
      session,
      workingDir: tempDir,
      maxIterations: 3,
      autoApprove: true,
    });

    const result = await orchestrator.runTurn('Lakukan scanning berulang', {
      maxIterations: 3,
    });

    assert.equal(result.success, false);
    assert.equal(result.loopLimitReached, true);
    assert.equal(result.iterations, 3);
    assert.equal(result.toolCalls.length, 3);
  });

  test('should support AbortSignal cancellation', async () => {
    const controller = new AbortController();
    controller.abort(new Error('User interrupted'));

    const mockGemini = {
      getModel: () => 'gemini-2.5-flash',
      generateStream: async () => ({
        text: 'Working...',
        functionCalls: [],
      }),
    };

    const session = sessionManager.createSession({ workingDir: tempDir });
    const orchestrator = new AgentOrchestrator({
      llmClient: mockGemini,
      session,
      workingDir: tempDir,
    });

    await assert.rejects(async () => {
      await orchestrator.runTurn('Tugas panjang', {
        signal: controller.signal,
      });
    }, /User interrupted|aborted/);
  });

  test('should accept llmClient option', async () => {
    const mockClient = {
      getModel: () => 'gpt-4o',
      getApiKey: () => 'k',
      generateStream: async () => ({
        text: 'OpenAI answer',
        functionCalls: [],
        finishReason: 'STOP',
      }),
    };
    const session = sessionManager.createSession({ workingDir: tempDir, provider: 'openai' });
    const orchestrator = new AgentOrchestrator({
      llmClient: mockClient,
      session,
      workingDir: tempDir,
    });
    assert.equal(orchestrator.llmClient, mockClient);
    const result = await orchestrator.runTurn('hi');
    assert.equal(result.text, 'OpenAI answer');
  });
});

describe('Step 4: Orchestrator Usage Accumulation', () => {
  let tempDir;
  let sessionManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'termuxai-usage-test-'));
    sessionManager = new SessionManager({ sessionsDir: tempDir });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test('accumulates real usage across iterations into session metadata', async () => {
    fs.writeFileSync(path.join(tempDir, 'hello.txt'), 'Content from file!', 'utf8');

    let callCount = 0;
    const mockGemini = {
      getModel: () => 'gemini-2.5-flash',
      generateStream: async () => {
        callCount++;
        if (callCount === 1) {
          return {
            text: 'Membaca file.',
            functionCalls: [{ name: 'read_file', args: { filePath: 'hello.txt' } }],
            finishReason: 'STOP',
            usage: { promptTokenCount: 1000, candidatesTokenCount: 50, totalTokenCount: 1050 },
          };
        }
        return {
          text: 'Selesai.',
          functionCalls: [],
          finishReason: 'STOP',
          usage: { promptTokenCount: 2000, candidatesTokenCount: 100, totalTokenCount: 2100 },
        };
      },
    };

    const session = sessionManager.createSession({ workingDir: tempDir });
    const orchestrator = new AgentOrchestrator({
      llmClient: mockGemini,
      session,
      workingDir: tempDir,
      autoApprove: true,
    });

    await orchestrator.runTurn('Baca file hello.txt', {});

    const usage = session.metadata.usage;
    assert.equal(usage.llmRequests, 2);
    assert.equal(usage.promptTokens, 3000);
    assert.equal(usage.completionTokens, 150);
    assert.equal(usage.totalTokens, 3150);
    assert.equal(usage.lastPromptTokens, 2000);
    assert.ok(usage.estTokensAtLastRequest > 0);
    assert.ok(usage.updatedAt);
  });

  test('budget check stops the loop when real context exceeds the limit', async () => {
    let callCount = 0;
    const mockGemini = {
      getModel: () => 'gemini-2.5-flash',
      generateStream: async () => {
        callCount++;
        return {
          text: 'loop attempt',
          functionCalls: [{ name: 'read_file', args: { filePath: 'missing.txt' } }],
          finishReason: 'STOP',
          usage: { promptTokenCount: 950000, candidatesTokenCount: 10, totalTokenCount: 950010 },
        };
      },
    };

    const session = sessionManager.createSession({ workingDir: tempDir });
    const orchestrator = new AgentOrchestrator({
      llmClient: mockGemini,
      session,
      workingDir: tempDir,
      autoApprove: true,
    });

    const result = await orchestrator.runTurn('keep going', {});

    // Iteration 1 passes the estimator check (no usage yet), records 950k real
    // usage; iteration 2's getContextTokens() exceeds the 736k trigger → compact.
    // Head is empty (3 messages ≤ keep window) → noop ×2 → break at iteration 3.
    assert.equal(callCount, 1);
    assert.equal(result.iterations, 3);
    assert.equal(result.loopLimitReached, false);
    assert.equal(result.success, true);
  });

  test('no usage reported → metadata.usage exists but stays zeroed on totals', async () => {
    const mockGemini = {
      getModel: () => 'gemini-2.5-flash',
      generateStream: async () => ({
        text: 'Halo!',
        functionCalls: [],
        finishReason: 'STOP',
      }),
    };

    const session = sessionManager.createSession({ workingDir: tempDir });
    const orchestrator = new AgentOrchestrator({
      llmClient: mockGemini,
      session,
      workingDir: tempDir,
    });

    await orchestrator.runTurn('Halo', {});

    const usage = session.metadata.usage;
    assert.ok(usage); // markRequestStart created the accumulator
    assert.equal(usage.llmRequests, 0);
    assert.equal(usage.totalTokens, 0);
    assert.ok(usage.estTokensAtLastRequest > 0);
  });
});

describe('Unlimited loop with auto-compact', () => {
  let tempDir;
  let sessionManager;
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'termuxai-unlimited-test-'));
    sessionManager = new SessionManager({ sessionsDir: tempDir });
  });
  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test('default maxIterations is Infinity and loop runs past 30', async () => {
    let callCount = 0;
    const mock = {
      getModel: () => 'gemini-2.5-flash',
      generateStream: async () => {
        callCount++;
        if (callCount >= 35) return { text: 'done', functionCalls: [] };
        return { text: 'tick', functionCalls: [{ name: 'list_dir', args: { dirPath: '.' } }] };
      },
    };
    const session = sessionManager.createSession({ workingDir: tempDir });
    const orchestrator = new AgentOrchestrator({
      llmClient: mock,
      session,
      workingDir: tempDir,
      autoApprove: true,
      reflectionInterval: 0, // reflection would stop the repetitive loop
    });
    assert.equal(orchestrator.maxIterations, Infinity);
    const result = await orchestrator.runTurn('keep ticking');
    assert.equal(result.iterations, 35);
    assert.equal(result.loopLimitReached, false);
    assert.equal(result.success, true);
  });

  test('budget exceeded triggers compact then continues (not break)', async () => {
    let callCount = 0;
    const mock = {
      getModel: () => 'gemini-2.5-flash',
      generateStream: async () => {
        callCount++;
        if (callCount >= 2) return { text: 'finished', functionCalls: [] };
        return {
          text: 'big turn',
          functionCalls: [{ name: 'list_dir', args: { dirPath: '.' } }],
          usage: { promptTokenCount: 950000, candidatesTokenCount: 10, totalTokenCount: 950010 },
        };
      },
      generate: async () => ({ text: 'compact summary' }), // compactSession LLM call
    };
    const session = sessionManager.createSession({ workingDir: tempDir });
    // Pre-seed 12 turns so the session exceeds COMPACT_KEEP_RECENT (10) —
    // otherwise splitForCompact returns an empty head and compact is a noop.
    for (let i = 0; i < 12; i++) {
      session.addMessage({
        role: 'model',
        parts: [{ functionCall: { name: 'list_dir', args: { dirPath: `d${i}` } } }],
      });
      session.addFunctionResponseMessage('list_dir', { content: `out ${i}` });
    }
    const orchestrator = new AgentOrchestrator({
      llmClient: mock,
      session,
      workingDir: tempDir,
      autoApprove: true,
      maxContextTokens: 1000000, // trigger = 920k; iter 1 records 950k real → over
      reflectionInterval: 0,
    });
    const compactEvents = [];
    const result = await orchestrator.runTurn('go', {
      onCompactStart: () => compactEvents.push('start'),
      onCompactEnd: (r) => compactEvents.push(['end', r.method]),
    });
    assert.equal(callCount, 2); // loop continued past the budget check
    assert.equal(result.text, 'finished');
    assert.deepEqual(compactEvents, ['start', ['end', 'llm']]);
    assert.match(session.getMessages()[0].parts[0].text, /\[Compact summary\]/);
  });

  test('two consecutive noop compacts break the loop with warning', async () => {
    const mock = {
      getModel: () => 'gemini-2.5-flash',
      generateStream: async () => ({
        text: 'y'.repeat(400000),
        functionCalls: [{ name: 'list_dir', args: { dirPath: '.' } }],
      }),
    };
    const session = sessionManager.createSession({ workingDir: tempDir });
    const warnings = [];
    const orchestrator = new AgentOrchestrator({
      llmClient: mock,
      session,
      workingDir: tempDir,
      autoApprove: true,
      maxContextTokens: 100000, // trigger 92k — first turn already over
      reflectionInterval: 0,
      logger: { warn: (m) => warnings.push(m), info: () => {}, error: () => {} },
    });
    const result = await orchestrator.runTurn('go');
    assert.equal(result.loopLimitReached, false);
    assert.ok(warnings.some((w) => /compaction could not reduce/i.test(w)));
    assert.ok(result.iterations <= 5, `expected early break, got ${result.iterations}`);
  });
});
