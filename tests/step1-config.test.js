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
    tmpDir = path.join(os.tmpdir(), `termuxai-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
    assert.equal(config.activeProvider, 'gemini');
    assert.equal(config.timeoutMs, 30000);
    assert.equal(fs.existsSync(manager.getConfigPath()), true);
    assert.equal(fs.existsSync(manager.getSessionsDir()), true);
  });

  test('should get and set config properties with correct type casting', () => {
    manager.set('activeProvider', 'openai');
    assert.equal(manager.get('activeProvider'), 'openai');

    manager.set('timeoutMs', '45000');
    assert.equal(manager.get('timeoutMs'), 45000);

    manager.set('autoConfirm', 'true');
    assert.equal(manager.get('autoConfirm'), true);

    manager.set('autoConfirm', false);
    assert.equal(manager.get('autoConfirm'), false);
  });

  test('should delete / reset specific config key', () => {
    manager.set('activeProvider', 'openai');
    assert.equal(manager.get('activeProvider'), 'openai');

    manager.delete('activeProvider');
    assert.equal(manager.get('activeProvider'), 'gemini');
  });

  test('should reset all configs to defaults', () => {
    manager.set('activeProvider', 'openai');
    manager.set('timeoutMs', 99999);
    manager.set('providers.gemini.apiKey', 'my-api-key');

    manager.reset();

    const loaded = manager.loadConfig();
    assert.equal(loaded.activeProvider, 'gemini');
    assert.equal(loaded.timeoutMs, DEFAULT_CONFIG.timeoutMs);
    assert.deepEqual(loaded.providers, {});
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

      // 3. TERMUXAI_API_KEY takes priority over T_AI_API_KEY
      delete process.env.GEMINI_API_KEY;
      process.env.TERMUXAI_API_KEY = 'env-termuxai-key';
      assert.equal(manager.getApiKey(), 'env-termuxai-key');

      // 4. T_AI_API_KEY env takes fallback priority
      delete process.env.TERMUXAI_API_KEY;
      process.env.T_AI_API_KEY = 'env-tai-key';
      assert.equal(manager.getApiKey(), 'env-tai-key');

      // 5. File apiKey takes lowest priority
      delete process.env.T_AI_API_KEY;
      assert.equal(manager.getApiKey(), 'file-key');

      // 6. Returns null if none set
      manager.set('apiKey', '');
      manager.set('providers.gemini.apiKey', '');
      assert.equal(manager.getApiKey(), null);
    } finally {
      process.env = originalEnv;
    }
  });

  test('should prefer TERMUXAI_API_KEY over legacy T_AI_API_KEY', () => {
    const originalEnv = { ...process.env };
    try {
      delete process.env.GEMINI_API_KEY;
      process.env.TERMUXAI_API_KEY = 'env-termuxai-key';
      process.env.T_AI_API_KEY = 'env-tai-key';
      assert.equal(manager.getApiKey(), 'env-termuxai-key');

      // Drop new var, confirm legacy still works
      delete process.env.TERMUXAI_API_KEY;
      assert.equal(manager.getApiKey(), 'env-tai-key');
    } finally {
      delete process.env.TERMUXAI_API_KEY;
      delete process.env.T_AI_API_KEY;
      process.env = originalEnv;
    }
  });

  test('should prefer TERMUXAI_CONFIG_DIR over legacy T_AI_CONFIG_DIR', () => {
    const originalEnv = { ...process.env };
    try {
      const newDir = path.join(os.tmpdir(), `termuxai-cfg-${Date.now()}`);
      const legacyDir = path.join(os.tmpdir(), `legacy-cfg-${Date.now()}`);
      fs.mkdirSync(newDir, { recursive: true });
      fs.mkdirSync(legacyDir, { recursive: true });

      process.env.TERMUXAI_CONFIG_DIR = newDir;
      process.env.T_AI_CONFIG_DIR = legacyDir;
      const m = new ConfigManager();
      assert.equal(m.getConfigDir(), path.resolve(newDir));

      // Drop new var, confirm legacy still works
      delete process.env.TERMUXAI_CONFIG_DIR;
      assert.equal(m.getConfigDir(), path.resolve(legacyDir));
    } finally {
      delete process.env.TERMUXAI_CONFIG_DIR;
      delete process.env.T_AI_CONFIG_DIR;
      process.env = originalEnv;
    }
  });

test('should fall back to legacy ~/.t-ai directory when ~/.termuxai does not exist', () => {
  const originalEnv = { ...process.env };
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'termuxai-home-'));
  const legacyDir = path.join(sandboxHome, '.t-ai');
  fs.mkdirSync(legacyDir, { recursive: true });
  // Intentionally do NOT create .termuxai — this is the migration scenario.

  try {
    process.env.HOME = sandboxHome;
    process.env.USERPROFILE = sandboxHome;
    delete process.env.TERMUXAI_CONFIG_DIR;
    delete process.env.T_AI_CONFIG_DIR;

    const m = new ConfigManager();
    assert.equal(m.getConfigDir(), path.resolve(legacyDir));
  } finally {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    delete process.env.TERMUXAI_CONFIG_DIR;
    delete process.env.T_AI_CONFIG_DIR;
    try { fs.rmSync(sandboxHome, { recursive: true, force: true }); } catch {}
    process.env = originalEnv;
  }
});
});
