import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ConfigManager } from '../src/config/manager.js';
import { DEFAULT_CONFIG, DEFAULT_MODEL } from '../src/config/constants.js';

describe('Config Manager (src/config/manager.js)', () => {
  let tmpDir;
  let manager;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `t-ai-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    manager = new ConfigManager(tmpDir);
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch (_) {}
  });

  test('should create directories and default config on first load', () => {
    const config = manager.loadConfig();
    assert.equal(config.model, DEFAULT_MODEL);
    assert.equal(config.timeoutMs, 30000);
    assert.equal(fs.existsSync(manager.getConfigPath()), true);
    assert.equal(fs.existsSync(manager.getSessionsDir()), true);
  });

  test('should get and set config properties with correct type casting', () => {
    manager.set('model', 'gemini-2.5-pro');
    assert.equal(manager.get('model'), 'gemini-2.5-pro');

    manager.set('timeoutMs', '45000');
    assert.equal(manager.get('timeoutMs'), 45000);

    manager.set('autoConfirm', 'true');
    assert.equal(manager.get('autoConfirm'), true);

    manager.set('autoConfirm', false);
    assert.equal(manager.get('autoConfirm'), false);
  });

  test('should delete / reset specific config key', () => {
    manager.set('model', 'gemini-1.5-pro');
    assert.equal(manager.get('model'), 'gemini-1.5-pro');

    manager.delete('model');
    assert.equal(manager.get('model'), DEFAULT_MODEL);
  });

  test('should reset all configs to defaults', () => {
    manager.set('model', 'custom-model');
    manager.set('timeoutMs', 99999);
    manager.set('apiKey', 'my-api-key');

    manager.reset();

    const loaded = manager.loadConfig();
    assert.equal(loaded.model, DEFAULT_MODEL);
    assert.equal(loaded.timeoutMs, DEFAULT_CONFIG.timeoutMs);
    assert.equal(loaded.apiKey, '');
  });

  test('should list config with masked api key by default', () => {
    manager.set('apiKey', 'AIzaSyTestApiKeySecret1234');
    const listed = manager.list({ maskApiKey: true });
    assert.equal(listed.apiKey, 'AIza...1234');

    const listedUnmasked = manager.list({ maskApiKey: false });
    assert.equal(listedUnmasked.apiKey, 'AIzaSyTestApiKeySecret1234');
  });

  test('should resolve API key according to precedence order', () => {
    const originalEnv = { ...process.env };

    try {
      // 1. Override flag takes highest priority
      process.env.GEMINI_API_KEY = 'env-gemini-key';
      manager.set('apiKey', 'file-key');
      assert.equal(manager.getApiKey('cli-override-key'), 'cli-override-key');

      // 2. GEMINI_API_KEY env takes second priority
      assert.equal(manager.getApiKey(), 'env-gemini-key');

      // 3. T_AI_API_KEY env takes third priority
      delete process.env.GEMINI_API_KEY;
      process.env.T_AI_API_KEY = 'env-tai-key';
      assert.equal(manager.getApiKey(), 'env-tai-key');

      // 4. File apiKey takes lowest priority
      delete process.env.T_AI_API_KEY;
      assert.equal(manager.getApiKey(), 'file-key');

      // 5. Returns null if none set
      manager.set('apiKey', '');
      assert.equal(manager.getApiKey(), null);
    } finally {
      process.env = originalEnv;
    }
  });
});
