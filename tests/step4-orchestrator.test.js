/**
 * Integration & Unit Tests: Core ReAct Agent Orchestrator
 * Step 4: ReAct Agentic Loop & Conversation State Engine
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { AgentOrchestrator, createAgentOrchestrator } from '../src/agent/orchestrator.js';
import { Session, SessionManager } from '../src/agent/session.js';
import { SecurityGuard } from '../src/security/guard.js';
import { GeminiClient } from '../src/llm/gemini.js';

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
        finishReason: 'STOP'
      })
    };

    const session = sessionManager.createSession({ workingDir: tempDir });
    const orchestrator = new AgentOrchestrator({
      geminiClient: mockGemini,
      session,
      workingDir: tempDir
    });

    const tokens = [];
    const result = await orchestrator.runTurn('Halo siapa kamu?', {
      onToken: (t) => tokens.push(t)
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
    assert.equal(messages[1].parts[0].text, 'Halo! Saya asisten termuxai siap membantu Anda di Termux.');
  });

  test('should execute single tool call (read_file) and continue to final response', async () => {
    // Create test file in workspace
    const testFile = path.join(tempDir, 'hello.txt');
    fs.writeFileSync(testFile, 'Content from file!', 'utf8');

    let callCount = 0;
    const mockGemini = {
      getModel: () => 'gemini-2.5-flash',
      generateStream: async ({ contents }) => {
        callCount++;
        if (callCount === 1) {
          // Model decides to read the file
          return {
            text: 'Saya akan membaca file hello.txt terlebih dahulu.',
            functionCalls: [
              {
                name: 'read_file',
                args: { filePath: 'hello.txt' }
              }
            ],
            finishReason: 'STOP'
          };
        } else {
          // Model analyzes tool response and answers
          return {
            text: 'Isi file hello.txt adalah: Content from file!',
            functionCalls: [],
            finishReason: 'STOP'
          };
        }
      }
    };

    const session = sessionManager.createSession({ workingDir: tempDir });
    const orchestrator = new AgentOrchestrator({
      geminiClient: mockGemini,
      session,
      workingDir: tempDir,
      autoApprove: true
    });

    const toolEvents = [];
    const result = await orchestrator.runTurn('Baca isi file hello.txt', {
      onToolCall: (fc) => toolEvents.push({ event: 'start', name: fc.name }),
      onToolResult: (name, res) => toolEvents.push({ event: 'end', name, res })
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
    assert.ok(msgs[1].parts.some(p => p.functionCall));
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
            functionCalls: [{ name: 'write_file', args: { filePath: 'app.js', content: 'console.log("App ready");' } }]
          };
        } else if (callCount === 2) {
          return {
            text: 'Membaca kembali app.js...',
            functionCalls: [{ name: 'read_file', args: { filePath: 'app.js' } }]
          };
        } else {
          return {
            text: 'File app.js berhasil dibuat dan diverifikasi!',
            functionCalls: []
          };
        }
      }
    };

    const session = sessionManager.createSession({ workingDir: tempDir });
    const orchestrator = new AgentOrchestrator({
      geminiClient: mockGemini,
      session,
      workingDir: tempDir,
      autoApprove: true
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
            functionCalls: [{ name: 'read_file', args: { filePath: 'non_existent.json' } }]
          };
        } else if (callCount === 2) {
          // Verify model receives error payload in history
          const lastMsg = contents[contents.length - 1];
          assert.equal(lastMsg.role, 'function');
          assert.equal(lastMsg.parts[0].functionResponse.response.error, true);

          // Model corrects by creating the file instead
          return {
            text: 'File tidak ditemukan, saya akan membuatnya.',
            functionCalls: [{ name: 'write_file', args: { filePath: 'config.json', content: '{"port":3000}' } }]
          };
        } else {
          return {
            text: 'Konfigurasi default berhasil dibuat!',
            functionCalls: []
          };
        }
      }
    };

    const session = sessionManager.createSession({ workingDir: tempDir });
    const orchestrator = new AgentOrchestrator({
      geminiClient: mockGemini,
      session,
      workingDir: tempDir,
      autoApprove: true
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
            functionCalls: [{ name: 'execute_command', args: { command: 'rm -rf /' } }]
          };
        } else {
          return {
            text: 'Perintah diblokir oleh sistem keamanan demi keselamatan.',
            functionCalls: []
          };
        }
      }
    };

    const session = sessionManager.createSession({ workingDir: tempDir });
    const orchestrator = new AgentOrchestrator({
      geminiClient: mockGemini,
      session,
      workingDir: tempDir
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
        functionCalls: [{ name: 'list_dir', args: { dirPath: '.' } }]
      })
    };

    const session = sessionManager.createSession({ workingDir: tempDir });
    const orchestrator = new AgentOrchestrator({
      geminiClient: mockGemini,
      session,
      workingDir: tempDir,
      maxIterations: 3,
      autoApprove: true
    });

    const result = await orchestrator.runTurn('Lakukan scanning berulang', {
      maxIterations: 3
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
        functionCalls: []
      })
    };

    const session = sessionManager.createSession({ workingDir: tempDir });
    const orchestrator = new AgentOrchestrator({
      geminiClient: mockGemini,
      session,
      workingDir: tempDir
    });

    await assert.rejects(
      async () => {
        await orchestrator.runTurn('Tugas panjang', {
          signal: controller.signal
        });
      },
      /User interrupted|aborted/
    );
  });

  test('should accept llmClient option and ignore geminiClient fallback', async () => {
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

