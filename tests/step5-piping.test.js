/**
 * Step 5 Test Suite: UNIX Piping, Slash Commands & Single-Shot Runner
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, PassThrough } from 'node:stream';
import {
  isPipedInput,
  readPipedStdin,
  mergePipedPrompt,
  isSlashCommand,
  executeSlashCommand,
  runSingleShot,
  createSession,
  ConfigManager,
  stripAnsi
} from '../src/index.js';

describe('Step 5: UNIX Stdin Piping Handler', () => {
  test('isPipedInput should correctly identify piped vs TTY streams', () => {
    const ttyStream = { isTTY: true };
    const pipedStream = { isTTY: false };

    assert.strictEqual(isPipedInput(ttyStream), false);
    assert.strictEqual(isPipedInput(pipedStream), true);
    assert.strictEqual(isPipedInput(null), false);
  });

  test('readPipedStdin should read stream content across multiple chunks', async () => {
    const mockStdin = new Readable({
      read() {}
    });
    mockStdin.isTTY = false;

    process.nextTick(() => {
      mockStdin.push(Buffer.from('Error: NullPointerException\n'));
      mockStdin.push(Buffer.from('  at Server.java:42\n'));
      mockStdin.push(null); // EOF
    });

    const result = await readPipedStdin({ stream: mockStdin, timeoutMs: 1000 });
    assert.strictEqual(result, 'Error: NullPointerException\n  at Server.java:42');
  });

  test('readPipedStdin should return empty string if stream is a TTY', async () => {
    const mockStdin = new Readable({ read() {} });
    mockStdin.isTTY = true;

    const result = await readPipedStdin({ stream: mockStdin });
    assert.strictEqual(result, '');
  });

  test('readPipedStdin should reject if input exceeds maxBytes', async () => {
    const mockStdin = new Readable({ read() {} });
    mockStdin.isTTY = false;

    process.nextTick(() => {
      mockStdin.push(Buffer.alloc(200));
      mockStdin.push(null);
    });

    await assert.rejects(
      async () => {
        await readPipedStdin({ stream: mockStdin, maxBytes: 100 });
      },
      /exceeded maximum size limit/
    );
  });

  test('mergePipedPrompt should combine piped content with user instruction', () => {
    const pipedData = 'const a = 1;\nconst b = 2;';
    const instruction = 'refactor this code';

    const merged = mergePipedPrompt(pipedData, instruction);
    assert.ok(merged.includes('[Piped Input Content]:'));
    assert.ok(merged.includes('const a = 1;'));
    assert.ok(merged.includes('[Instruction]:'));
    assert.ok(merged.includes('refactor this code'));
  });

  test('mergePipedPrompt should generate default instruction if user prompt is empty', () => {
    const pipedData = 'server connection reset';
    const merged = mergePipedPrompt(pipedData, '');

    assert.ok(merged.includes('[Piped Input Content]:'));
    assert.ok(merged.includes('server connection reset'));
    assert.ok(merged.includes('Please analyze'));
  });
});

describe('Step 5: REPL Slash Commands Handler', () => {
  test('isSlashCommand should detect commands starting with slash', () => {
    assert.strictEqual(isSlashCommand('/help'), true);
    assert.strictEqual(isSlashCommand('  /model gemini-2.5-pro '), true);
    assert.strictEqual(isSlashCommand('buatkan fungsi login'), false);
    assert.strictEqual(isSlashCommand(''), false);
  });

  test('executeSlashCommand /help should render help menu', async () => {
    const output = new PassThrough();
    let written = '';
    output.on('data', chunk => {
      written += chunk.toString('utf8');
    });

    const res = await executeSlashCommand('/help', { stream: output });
    assert.strictEqual(res.handled, true);
    assert.strictEqual(res.action, 'help');

    const plain = stripAnsi(written);
    assert.ok(plain.includes('/help'));
    assert.ok(plain.includes('/model'));
    assert.ok(plain.includes('/session'));
    assert.ok(plain.includes('/exit'));
  });

  test('executeSlashCommand /model should view and switch active model', async () => {
    const output = new PassThrough();
    const mockOrchestrator = {
      geminiClient: {
        model: 'gemini-2.5-flash',
        getModel() { return this.model; }
      },
      session: { model: 'gemini-2.5-flash' }
    };

    // Query active model
    const res1 = await executeSlashCommand('/model', {
      orchestrator: mockOrchestrator,
      stream: output
    });
    assert.strictEqual(res1.action, 'model_info');
    assert.strictEqual(res1.message, 'gemini-2.5-flash');

    // Switch model
    const res2 = await executeSlashCommand('/model gemini-2.5-pro', {
      orchestrator: mockOrchestrator,
      stream: output
    });
    assert.strictEqual(res2.action, 'model_changed');
    assert.strictEqual(res2.message, 'gemini-2.5-pro');
  });

  // === Phase 1.3: /model without args renders model catalog box ===
  test('executeSlashCommand /model (no args) renders model catalog box with getProviderModels', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const os = await import('node:os');
    const { ConfigManager: CM } = await import('../src/config/manager.js');
    const tmpDir = path.join(os.tmpdir(), `tai-model-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const configMgr = new CM(tmpDir);

    const output = new PassThrough();
    let written = '';
    output.on('data', chunk => { written += chunk.toString('utf8'); });

    const mockOrchestrator = {
      provider: 'gemini',
      geminiClient: {
        model: 'gemini-2.5-flash',
        getModel() { return this.model; }
      }
    };

    const res = await executeSlashCommand('/model', {
      orchestrator: mockOrchestrator,
      configMgr,
      stream: output
    });
    assert.strictEqual(res.action, 'model_info');
    assert.strictEqual(res.message, 'gemini-2.5-flash');

    const plain = stripAnsi(written);
    // Box rendering should include all builtin gemini models
    assert.ok(plain.includes('Model (gemini)'), 'output should include box title');
    assert.ok(plain.includes('gemini-2.5-flash'));
    assert.ok(plain.includes('gemini-2.5-pro'));
    assert.ok(plain.includes('gemini-1.5-flash'));
    assert.ok(plain.includes('gemini-1.5-pro'));
    assert.ok(plain.includes('gemini-2.0-flash'));
    // Active model marker
    assert.ok(plain.includes('(active)'), 'active model should be marked');
    // Box should use unicode border characters (round style)
    assert.ok(/[╭╮╰╯─│]/.test(plain), 'output should include round-style box border chars');

    // cleanup
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  test('executeSlashCommand /model (no args) shows other providers section when multiple configured', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const os = await import('node:os');
    const { ConfigManager: CM } = await import('../src/config/manager.js');
    const tmpDir = path.join(os.tmpdir(), `tai-model-multi-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const configMgr = new CM(tmpDir);
    // Configure openai too
    configMgr.setProviderField('openai', 'apiKey', 'test-openai-key');

    const output = new PassThrough();
    let written = '';
    output.on('data', chunk => { written += chunk.toString('utf8'); });

    const mockOrchestrator = {
      provider: 'gemini',
      geminiClient: { model: 'gemini-2.5-flash', getModel() { return this.model; } }
    };

    await executeSlashCommand('/model', {
      orchestrator: mockOrchestrator,
      configMgr,
      stream: output
    });

    const plain = stripAnsi(written);
    // Other providers section should be present
    assert.ok(plain.includes('Other providers:'), 'should include other-providers section');
    assert.ok(plain.includes('openai:'), 'should list openai in other-providers');
    assert.ok(plain.includes('gpt-4o-mini'), 'should include openai builtin models');

    // cleanup
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  test('executeSlashCommand /model (no args) falls back to single-line when configMgr missing', async () => {
    const output = new PassThrough();
    let written = '';
    output.on('data', chunk => { written += chunk.toString('utf8'); });

    const mockOrchestrator = {
      provider: 'gemini',
      geminiClient: { model: 'gemini-2.5-flash', getModel() { return this.model; } }
    };

    // No configMgr -> should use single-line fallback
    const res = await executeSlashCommand('/model', {
      orchestrator: mockOrchestrator,
      stream: output
    });
    assert.strictEqual(res.action, 'model_info');
    assert.strictEqual(res.message, 'gemini-2.5-flash');

    const plain = stripAnsi(written);
    assert.ok(plain.includes('Active model: gemini-2.5-flash'));
    // No box should be rendered
    assert.ok(!/╔/.test(plain), 'fallback should not render box');
  });

  test('executeSlashCommand /model gemini-2.5-pro still works (set model unchanged behavior)', async () => {
    const output = new PassThrough();
    const mockOrchestrator = {
      provider: 'gemini',
      geminiClient: {
        model: 'gemini-2.5-flash',
        getModel() { return this.model; },
        setModel(m) { this.model = m; }
      },
      session: { model: 'gemini-2.5-flash' }
    };

    const res = await executeSlashCommand('/model gemini-2.5-pro', {
      orchestrator: mockOrchestrator,
      stream: output
    });
    assert.strictEqual(res.action, 'model_changed');
    assert.strictEqual(res.message, 'gemini-2.5-pro');
    assert.strictEqual(mockOrchestrator.geminiClient.getModel(), 'gemini-2.5-pro');
    assert.strictEqual(mockOrchestrator.session.model, 'gemini-2.5-pro');
  });

  test('executeSlashCommand /provider should view and switch active provider', async () => {
    const output = new PassThrough();
    let currentProvider = 'gemini';
    const mockOrchestrator = {
      provider: 'gemini',
      setProvider: (p) => { currentProvider = p; mockOrchestrator.provider = p; }
    };

    const res1 = await executeSlashCommand('/provider', {
      orchestrator: mockOrchestrator,
      stream: output
    });
    assert.strictEqual(res1.action, 'provider_info');

    const res2 = await executeSlashCommand('/provider openai', {
      orchestrator: mockOrchestrator,
      stream: output
    });
    assert.strictEqual(res2.action, 'provider_changed');
    assert.strictEqual(currentProvider, 'openai');

    const res3 = await executeSlashCommand('/provider list', {
      orchestrator: mockOrchestrator,
      stream: output
    });
    assert.strictEqual(res3.action, 'provider_list');
  });

  test('executeSlashCommand /session should display session details', async () => {
    const output = new PassThrough();
    let written = '';
    output.on('data', chunk => {
      written += chunk.toString('utf8');
    });

    const session = createSession({ model: 'gemini-2.5-flash' });
    session.addUserMessage('Hello AI');
    session.addModelMessage('Hello! How can I help?');

    const mockOrchestrator = {
      session,
      geminiClient: { getModel: () => 'gemini-2.5-flash' },
      workingDir: process.cwd()
    };

    const res = await executeSlashCommand('/session', {
      orchestrator: mockOrchestrator,
      stream: output
    });

    assert.strictEqual(res.handled, true);
    assert.strictEqual(res.action, 'session_info');

    const plain = stripAnsi(written);
    assert.ok(plain.includes('Active Session Details'));
    assert.ok(plain.includes(session.id));
    assert.ok(plain.includes('gemini-2.5-flash'));
  });

  test('executeSlashCommand /config and /clear should operate properly', async () => {
    const output = new PassThrough();
    const configMgr = new ConfigManager();

    const configRes = await executeSlashCommand('/config', {
      configMgr,
      stream: output
    });
    assert.strictEqual(configRes.handled, true);
    assert.strictEqual(configRes.action, 'config_info');

    const clearRes = await executeSlashCommand('/clear', { stream: output });
    assert.strictEqual(clearRes.handled, true);
    assert.strictEqual(clearRes.action, 'clear');
  });

  test('executeSlashCommand /exit and /quit should signal REPL exit', async () => {
    const output = new PassThrough();
    const res1 = await executeSlashCommand('/exit', { stream: output });
    assert.strictEqual(res1.action, 'exit');

    const res2 = await executeSlashCommand('/quit', { stream: output });
    assert.strictEqual(res2.action, 'exit');
  });

  test('executeSlashCommand should handle unknown commands with helpful suggestion', async () => {
    const output = new PassThrough();
    let written = '';
    output.on('data', chunk => {
      written += chunk.toString('utf8');
    });

    const res = await executeSlashCommand('/foobar', { stream: output });
    assert.strictEqual(res.handled, true);
    assert.strictEqual(res.error, true);

    const plain = stripAnsi(written);
    assert.ok(plain.includes('Unknown slash command: "/foobar"'));
    assert.ok(plain.includes('/help'));
  });
});

describe('Step 5: Single-Shot Command Runner', () => {
  test('runSingleShot should execute prompt through orchestrator and stream output', async () => {
    const output = new PassThrough();
    let written = '';
    output.on('data', chunk => {
      written += chunk.toString('utf8');
    });

    const mockOrchestrator = {
      workingDir: process.cwd(),
      async runTurn(prompt, options) {
        if (options.onIterationStart) options.onIterationStart(1);
        if (options.onToken) {
          options.onToken('Hasil ');
          options.onToken('analisis.');
        }
        return {
          success: true,
          text: 'Hasil analisis.',
          iterations: 1,
          toolCalls: [],
          session: { id: 'sess_test_123' }
        };
      }
    };

    const outcome = await runSingleShot('analisis file', {
      orchestrator: mockOrchestrator,
      stream: output,
      streamTokens: true
    });

    assert.strictEqual(outcome.success, true);
    assert.strictEqual(outcome.text, 'Hasil analisis.');
    assert.strictEqual(outcome.iterations, 1);
    assert.ok(written.includes('Hasil analisis.'));
  });

  test('runSingleShot should handle tool calls and tool responses during execution', async () => {
    const output = new PassThrough();
    let written = '';
    output.on('data', chunk => {
      written += chunk.toString('utf8');
    });

    const mockOrchestrator = {
      workingDir: process.cwd(),
      async runTurn(prompt, options) {
        if (options.onIterationStart) options.onIterationStart(1);
        if (options.onToolCall) {
          options.onToolCall({ name: 'read_file', args: { filePath: 'test.js' } });
        }
        if (options.onToolResult) {
          options.onToolResult('read_file', { content: 'console.log("hi")' });
        }
        if (options.onToken) {
          options.onToken('Selesai membaca berkas.');
        }
        return {
          success: true,
          text: 'Selesai membaca berkas.',
          iterations: 2,
          toolCalls: [{ name: 'read_file' }]
        };
      }
    };

    const outcome = await runSingleShot('baca test.js', {
      orchestrator: mockOrchestrator,
      stream: output
    });

    assert.strictEqual(outcome.success, true);
    assert.strictEqual(outcome.iterations, 2);
    const plain = stripAnsi(written);
    assert.ok(plain.includes('read_file'));
    assert.ok(plain.includes('Selesai membaca berkas.'));
  });

  test('runSingleShot should handle aborted turns cleanly', async () => {
    const output = new PassThrough();
    const abortCtrl = new AbortController();
    abortCtrl.abort();

    const mockOrchestrator = {
      async runTurn() {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        throw err;
      }
    };

    const outcome = await runSingleShot('tugas panjang', {
      orchestrator: mockOrchestrator,
      signal: abortCtrl.signal,
      stream: output
    });

    assert.strictEqual(outcome.success, false);
  });
});
