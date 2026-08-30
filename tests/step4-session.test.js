/**
 * Unit Tests: Session Management, Environment Injection & Context Pruning
 * Step 4: ReAct Agentic Loop & Conversation State Engine
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  estimatePartTokens,
  estimateTokens,
  pruneMessages,
  sanitizeConversationHistory,
} from '../src/agent/pruner.js';
import { generateSessionId, Session, SessionManager } from '../src/agent/session.js';
import { buildSystemPrompt, detectEnvironment } from '../src/agent/system-prompt.js';

describe('Step 4: System Prompt & Environment Detection', () => {
  test('detectEnvironment should identify host OS, arch and working directory', () => {
    const env = detectEnvironment();
    assert.ok(typeof env.isTermux === 'boolean');
    assert.ok(env.platform);
    assert.ok(env.arch);
    assert.ok(env.nodeVersion);
    assert.ok(env.workingDir);
    assert.ok(env.datetime);
    assert.ok(env.timezone);
  });

  test('detectEnvironment should recognize Termux environment flags', () => {
    const fakeTermuxEnv = detectEnvironment({
      env: {
        PREFIX: '/data/data/com.termux/files/usr',
        TERMUX_VERSION: '0.118.0',
        HOME: '/data/data/com.termux/files/home',
      },
      workingDir: '/data/data/com.termux/files/home/workspace',
    });

    assert.equal(fakeTermuxEnv.isTermux, true);
    assert.equal(fakeTermuxEnv.osType, 'Android (Termux Environment)');
    assert.equal(fakeTermuxEnv.username, 'termux');
  });

  test('buildSystemPrompt should assemble full instructions with environment info and custom prompt', () => {
    const prompt = buildSystemPrompt({
      workingDir: '/test/dir',
      customInstructions: 'Please write all responses in Indonesian language.',
    });

    assert.ok(prompt.includes('termuxai (Termux AI)'));
    assert.ok(prompt.includes('### OPERATIONAL GUIDELINES & REACT PARADIGM'));
    assert.ok(prompt.includes('### ACTIVE ENVIRONMENT CONTEXT'));
    assert.ok(prompt.includes('/test/dir'));
    assert.ok(prompt.includes('Please write all responses in Indonesian language.'));
  });
});

describe('Step 4: Token Estimator & Context Pruner', () => {
  test('estimateTokens should accurately calculate token heuristics for strings and parts', () => {
    assert.equal(estimateTokens(''), 0);
    assert.equal(estimateTokens('abcd'), 1);
    assert.equal(estimateTokens('abcdefgh'), 2);

    const partText = { text: 'Hello World!' }; // 12 chars -> ~3 tokens
    assert.equal(estimatePartTokens(partText), 3);

    const partFnCall = {
      functionCall: {
        name: 'write_file',
        args: { filePath: 'index.js', content: 'console.log("hi");' },
      },
    };
    assert.ok(estimatePartTokens(partFnCall) > 5);

    const message = {
      role: 'user',
      parts: [{ text: 'Hello AI assistant' }],
    };
    // Message overhead (4) + text tokens (~5)
    assert.ok(estimateTokens(message) >= 8);
  });

  test('pruneMessages should leave conversation untouched if within token budget', () => {
    const messages = [
      { role: 'user', parts: [{ text: 'Step 1' }] },
      { role: 'model', parts: [{ text: 'Step 1 reply' }] },
      { role: 'user', parts: [{ text: 'Step 2' }] },
    ];

    const pruned = pruneMessages(messages, { maxTokens: 10000 });
    assert.equal(pruned.length, 3);
    assert.deepEqual(pruned, messages);
  });

  test('pruneMessages should prune middle turns when exceeding token limit', () => {
    const longText = 'A'.repeat(400); // ~100 tokens per message

    const messages = [
      { role: 'user', parts: [{ text: 'Initial user prompt' }] }, // Message 0 (First)
      { role: 'model', parts: [{ text: `Turn 1 ${longText}` }] }, // Middle 1
      { role: 'user', parts: [{ text: `Turn 2 ${longText}` }] }, // Middle 2
      { role: 'model', parts: [{ text: `Turn 3 ${longText}` }] }, // Middle 3
      { role: 'user', parts: [{ text: `Turn 4 ${longText}` }] }, // Middle 4
      { role: 'user', parts: [{ text: 'Recent turn 1' }] }, // Recent
      { role: 'model', parts: [{ text: 'Recent turn 2' }] }, // Recent
    ];

    // Set budget tight enough so middle turns get pruned
    const pruned = pruneMessages(messages, {
      maxTokens: 250,
      preserveRecentCount: 2,
      keepFirst: true,
    });

    assert.ok(pruned.length < messages.length);
    // Initial message preserved
    assert.equal(pruned[0].parts[0].text, 'Initial user prompt');
    // Most recent messages preserved
    assert.equal(pruned[pruned.length - 1].parts[0].text, 'Recent turn 2');
    assert.equal(pruned[pruned.length - 2].parts[0].text, 'Recent turn 1');
  });

  test('sanitizeConversationHistory should drop orphaned function responses', () => {
    const invalidHistory = [
      { role: 'user', parts: [{ text: 'Hi' }] },
      {
        role: 'function',
        parts: [{ functionResponse: { name: 'read_file', response: { content: 'test' } } }],
      }, // Orphaned: no previous model functionCall
      { role: 'model', parts: [{ text: 'Hello' }] },
    ];

    const sanitized = sanitizeConversationHistory(invalidHistory);
    assert.equal(sanitized.length, 2);
    assert.equal(sanitized[0].role, 'user');
    assert.equal(sanitized[1].role, 'model');
  });
});

describe('Step 4: Session Manager & Atomic File Persistence', () => {
  let tempDir;
  let sessionManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'termuxai-session-test-'));
    sessionManager = new SessionManager({ sessionsDir: tempDir });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test('generateSessionId should create unique valid IDs with sess_ prefix', () => {
    const id1 = generateSessionId();
    const id2 = generateSessionId();
    assert.ok(id1.startsWith('sess_'));
    assert.ok(id2.startsWith('sess_'));
    assert.notEqual(id1, id2);
  });

  test('Session class should append and format various message roles', () => {
    const session = new Session({ id: 'sess_test_123', workingDir: tempDir });

    session.addUserMessage('Hello world');
    session.addFunctionCallMessage('list_dir', { dirPath: '.' });
    session.addFunctionResponseMessage('list_dir', { files: ['a.js', 'b.js'] });
    session.addModelMessage('Here are your files');

    const messages = session.getMessages();
    assert.equal(messages.length, 4);

    assert.equal(messages[0].role, 'user');
    assert.equal(messages[0].parts[0].text, 'Hello world');

    assert.equal(messages[1].role, 'model');
    assert.equal(messages[1].parts[0].functionCall.name, 'list_dir');

    assert.equal(messages[2].role, 'function');
    assert.equal(messages[2].parts[0].functionResponse.name, 'list_dir');

    assert.equal(messages[3].role, 'model');
    assert.equal(messages[3].parts[0].text, 'Here are your files');
  });

  test('SessionManager should save, check existence, and reload session atomically', () => {
    const session = sessionManager.createSession({
      model: 'gemini-2.5-pro',
      workingDir: tempDir,
    });

    session.addUserMessage('Buatkan server express');
    session.addModelMessage('Baik, saya akan membuat server.');

    assert.equal(sessionManager.hasSession(session.id), false);

    sessionManager.saveSession(session);
    assert.equal(sessionManager.hasSession(session.id), true);

    const loaded = sessionManager.loadSession(session.id);
    assert.equal(loaded.id, session.id);
    assert.equal(loaded.model, 'gemini-2.5-pro');
    assert.equal(loaded.getMessages().length, 2);
    assert.equal(loaded.getMessages()[0].parts[0].text, 'Buatkan server express');
    assert.equal(loaded.getMessages()[1].parts[0].text, 'Baik, saya akan membuat server.');
  });

  test('SessionManager listSessions should return sorted list with previews', async () => {
    const session1 = sessionManager.createSession({ id: 'sess_001' });
    session1.addUserMessage('First session task');
    sessionManager.saveSession(session1);

    // Ensure timestamp distinction
    await new Promise((r) => setTimeout(r, 10));

    const session2 = sessionManager.createSession({ id: 'sess_002' });
    session2.addUserMessage('Second session task');
    sessionManager.saveSession(session2);

    const list = sessionManager.listSessions();
    assert.equal(list.length, 2);
    // Most recently updated should be first
    assert.equal(list[0].id, 'sess_002');
    assert.equal(list[0].preview, 'Second session task');
    assert.equal(list[1].id, 'sess_001');
  });

  test('SessionManager deleteSession and clearSessions should remove session files', () => {
    const session1 = sessionManager.createSession({ id: 'sess_del_1' });
    const session2 = sessionManager.createSession({ id: 'sess_del_2' });

    sessionManager.saveSession(session1);
    sessionManager.saveSession(session2);

    assert.equal(sessionManager.listSessions().length, 2);

    const deleted = sessionManager.deleteSession('sess_del_1');
    assert.equal(deleted, true);
    assert.equal(sessionManager.listSessions().length, 1);
    assert.equal(sessionManager.hasSession('sess_del_1'), false);

    const cleared = sessionManager.clearSessions();
    assert.equal(cleared, 1);
    assert.equal(sessionManager.listSessions().length, 0);
  });

  test('should persist and restore provider field', () => {
    const sess = sessionManager.createSession({
      provider: 'openai',
      model: 'gpt-4o',
      workingDir: tempDir,
    });
    assert.equal(sess.provider, 'openai');
    assert.equal(sess.model, 'gpt-4o');

    sess.save();
    const loaded = sessionManager.loadSession(sess.id);
    assert.equal(loaded.provider, 'openai');
    assert.equal(loaded.model, 'gpt-4o');
  });
});
