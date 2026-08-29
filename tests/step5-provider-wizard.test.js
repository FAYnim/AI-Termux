/**
 * Tests for provider-wizard.js
 * Tests helper functions (isLocalUrl, isApiKeyRequired) and runProviderAddWizard wizard.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { isLocalUrl, isApiKeyRequired, runProviderAddWizard } from '../src/cli/provider-wizard.js';
import { ConfigManager } from '../src/config/manager.js';

describe('provider-wizard: isLocalUrl', () => {
  test('returns true for localhost', () => {
    assert.strictEqual(isLocalUrl('http://localhost:11434/v1'), true);
  });
  test('returns true for 127.0.0.1', () => {
    assert.strictEqual(isLocalUrl('http://127.0.0.1:8080/v1'), true);
  });
  test('returns false for cloud URLs', () => {
    assert.strictEqual(isLocalUrl('https://api.groq.com/openai/v1'), false);
  });
  test('returns false for empty string', () => {
    assert.strictEqual(isLocalUrl(''), false);
  });
  test('returns false for null/undefined', () => {
    assert.strictEqual(isLocalUrl(null), false);
    assert.strictEqual(isLocalUrl(undefined), false);
  });
});

describe('provider-wizard: isApiKeyRequired', () => {
  test('gemini always requires API key', () => {
    assert.strictEqual(isApiKeyRequired('gemini', ''), true);
    assert.strictEqual(isApiKeyRequired('gemini', 'http://localhost/v1'), true);
  });
  test('openai + localhost → optional (Ollama)', () => {
    assert.strictEqual(isApiKeyRequired('openai', 'http://localhost:11434/v1'), false);
  });
  test('openai + 127.0.0.1 → optional', () => {
    assert.strictEqual(isApiKeyRequired('openai', 'http://127.0.0.1:11434/v1'), false);
  });
  test('openai + cloud URL → required', () => {
    assert.strictEqual(isApiKeyRequired('openai', 'https://api.groq.com/openai/v1'), true);
  });
  test('openai + empty (default OpenAI) → required', () => {
    assert.strictEqual(isApiKeyRequired('openai', ''), true);
  });
});

// Helper: build a fake readable input stream from a sequence of answers.
// Each answer maps to one readline.question() call in order.
function makeAnswerStream(answers) {
  const pt = new PassThrough();
  pt.isTTY = false;
  // Feed answers one-by-one on the next tick so readline can read them
  let i = 0;
  const feedNext = () => {
    if (i < answers.length) {
      pt.push(answers[i] + '\n');
      i++;
      setImmediate(feedNext);
    } else {
      pt.push(null); // EOF
    }
  };
  setImmediate(feedNext);
  return pt;
}

function makeTmpConfigMgr() {
  const tmpDir = path.join(os.tmpdir(), `tai-wiz-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  return new ConfigManager(tmpDir);
}

describe('runProviderAddWizard: happy paths', () => {
  test('openai cloud provider (wajib API key + base URL)', async () => {
    // Answers: id, adapter, baseUrl, apiKey, model, switchNow
    const answers = ['groq', 'openai', 'https://api.groq.com/openai/v1', 'gsk_test123', 'llama-3.3-70b', 'n'];
    const input = makeAnswerStream(answers);
    const output = new PassThrough();
    const configMgr = makeTmpConfigMgr();

    const result = await runProviderAddWizard({ configMgr, input, output });

    assert.strictEqual(result.cancelled, false);
    assert.strictEqual(result.providerId, 'groq');
    assert.strictEqual(result.config.adapter, 'openai');
    assert.strictEqual(result.config.baseUrl, 'https://api.groq.com/openai/v1');
    assert.strictEqual(result.config.apiKey, 'gsk_test123');
    assert.strictEqual(result.config.model, 'llama-3.3-70b');
    assert.strictEqual(result.switchNow, false);
  });

  test('gemini provider (base URL step skipped, API key required)', async () => {
    // Answers: id, adapter, [no baseUrl step], apiKey, model, switchNow
    const answers = ['my-gemini', 'gemini', 'AIzaSy_test', '', 'Y'];
    const input = makeAnswerStream(answers);
    const output = new PassThrough();
    const configMgr = makeTmpConfigMgr();

    const result = await runProviderAddWizard({ configMgr, input, output });

    assert.strictEqual(result.cancelled, false);
    assert.strictEqual(result.providerId, 'my-gemini');
    assert.strictEqual(result.config.adapter, 'gemini');
    assert.strictEqual(result.config.baseUrl, undefined);
    assert.strictEqual(result.config.apiKey, 'AIzaSy_test');
    assert.strictEqual(result.switchNow, true);
  });

  test('ollama provider (localhost → API key optional, Enter skips it)', async () => {
    // Answers: id, adapter, baseUrl, apiKey (empty = skip), model (empty = skip), switchNow
    const answers = ['ollama', 'openai', 'http://localhost:11434/v1', '', '', 'n'];
    const input = makeAnswerStream(answers);
    const output = new PassThrough();
    const configMgr = makeTmpConfigMgr();

    const result = await runProviderAddWizard({ configMgr, input, output });

    assert.strictEqual(result.cancelled, false);
    assert.strictEqual(result.providerId, 'ollama');
    assert.strictEqual(result.config.adapter, 'openai');
    assert.strictEqual(result.config.baseUrl, 'http://localhost:11434/v1');
    assert.strictEqual(result.config.apiKey, undefined);
    assert.strictEqual(result.config.model, undefined);
    assert.strictEqual(result.switchNow, false);
  });

  test('switchNow = Y (Enter) returns switchNow: true', async () => {
    const answers = ['deepseek', 'openai', 'https://api.deepseek.com/v1', 'sk_test', '', ''];
    const input = makeAnswerStream(answers);
    const output = new PassThrough();
    const configMgr = makeTmpConfigMgr();

    const result = await runProviderAddWizard({ configMgr, input, output });

    assert.strictEqual(result.cancelled, false);
    assert.strictEqual(result.switchNow, true); // Enter on [Y/n] → true
  });

  test('prefilledId skips Step 1 prompt', async () => {
    // No ID answer needed — already provided
    const answers = ['openai', 'https://openrouter.ai/api/v1', 'sk-or-test', '', 'n'];
    const input = makeAnswerStream(answers);
    const output = new PassThrough();
    const configMgr = makeTmpConfigMgr();

    const result = await runProviderAddWizard({ configMgr, input, output, prefilledId: 'openrouter' });

    assert.strictEqual(result.cancelled, false);
    assert.strictEqual(result.providerId, 'openrouter');
  });
});

describe('runProviderAddWizard: validation and error paths', () => {
  test('invalid adapter input → retry, then valid', async () => {
    // First adapter answer is invalid, second is valid
    // Wizard should retry and ultimately succeed with valid adapter
    const answers = ['myprov', 'badadapter', 'openai', 'https://example.com/v1', 'key123', '', 'n'];
    const input = makeAnswerStream(answers);
    const output = new PassThrough();
    const configMgr = makeTmpConfigMgr();

    const result = await runProviderAddWizard({ configMgr, input, output });

    // Key assertions: wizard should not cancel, should accept the valid adapter after retry
    assert.strictEqual(result.cancelled, false);
    assert.strictEqual(result.config.adapter, 'openai');
    assert.strictEqual(result.providerId, 'myprov');
  });

  test('empty API key on required field → retry, then valid', async () => {
    // First apiKey answer is empty (should be rejected for cloud), second is valid
    const answers = ['myprov2', 'openai', 'https://api.groq.com/v1', '', 'valid-key', '', 'n'];
    const input = makeAnswerStream(answers);
    const output = new PassThrough();
    const configMgr = makeTmpConfigMgr();

    const result = await runProviderAddWizard({ configMgr, input, output });

    // Key assertions: wizard accepted the valid key after rejecting the empty one
    assert.strictEqual(result.cancelled, false);
    assert.strictEqual(result.config.apiKey, 'valid-key');
    // The empty key was rejected and the valid key was accepted
    assert.strictEqual(result.config.adapter, 'openai');
  });

  test('provider ID already exists → confirm overwrite Y → continue', async () => {
    // Pre-seed config with existing provider
    const configMgr = makeTmpConfigMgr();
    const cfg = configMgr.loadConfig();
    cfg.providers = { existingprov: { adapter: 'openai' } };
    configMgr.saveConfig(cfg);

    // Answers: id (existing), overwrite=y, adapter, baseUrl, apiKey, model, switchNow
    const answers = ['existingprov', 'y', 'openai', 'https://api.groq.com/v1', 'newkey', '', 'n'];
    const input = makeAnswerStream(answers);
    const output = new PassThrough();
    const result = await runProviderAddWizard({ configMgr, input, output });

    assert.strictEqual(result.cancelled, false);
    assert.strictEqual(result.providerId, 'existingprov');
  });

  test('provider ID already exists → confirm overwrite N → ask new ID', async () => {
    const configMgr = makeTmpConfigMgr();
    const cfg = configMgr.loadConfig();
    cfg.providers = { existingprov: { adapter: 'openai' } };
    configMgr.saveConfig(cfg);

    // First ID = existing, overwrite = n, second ID = new one
    const answers = ['existingprov', 'n', 'newprov', 'openai', 'https://x.com/v1', 'key', '', 'n'];
    const input = makeAnswerStream(answers);
    const output = new PassThrough();
    const result = await runProviderAddWizard({ configMgr, input, output });

    assert.strictEqual(result.cancelled, false);
    assert.strictEqual(result.providerId, 'newprov');
  });

  test('ESC key cancels wizard', async () => {
    const input = new PassThrough();
    input.isTTY = false;
    // Send ESC (0x1b) then EOF
    input.push(Buffer.from([0x1b]));
    input.push(null);
    const output = new PassThrough();
    const configMgr = makeTmpConfigMgr();
    const result = await runProviderAddWizard({ configMgr, input, output });
    assert.strictEqual(result.cancelled, true);
  });
});
