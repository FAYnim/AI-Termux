import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ConfigManager } from '../src/config/manager.js';
import { BUILTIN_PROVIDERS, DEFAULT_ACTIVE_PROVIDER, DEFAULT_CONFIG } from '../src/config/constants.js';

describe('Step 1: Provider config constants & manager helpers', { concurrency: 1 }, () => {
  let tmpDir;
  let manager;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `termuxai-prov-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    manager = new ConfigManager(tmpDir);
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  test('constants expose builtin providers', () => {
    assert.ok(BUILTIN_PROVIDERS.gemini);
    assert.ok(BUILTIN_PROVIDERS.openai);
    assert.equal(DEFAULT_ACTIVE_PROVIDER, 'gemini');
    assert.equal(DEFAULT_CONFIG.activeProvider, 'gemini');
    assert.deepEqual(DEFAULT_CONFIG.providers, {});
  });

  test('auto-promotes legacy config on first load', () => {
    // Write legacy config without providers block
    const legacy = { apiKey: 'legacy-key-abc', model: 'gemini-2.5-flash' };
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify(legacy));
    const cfg = manager.loadConfig();

    assert.equal(cfg.activeProvider, 'gemini');
    assert.ok(cfg.providers?.gemini);
    assert.equal(cfg.providers.gemini.apiKey, 'legacy-key-abc');
  });

  test('getProviderConfig merges builtins, stored values, env vars (stored wins)', () => {
    manager.set('providers.openai.apiKey', 'stored-key');
    const originalEnv = { ...process.env };
    try {
      process.env.OPENAI_API_KEY = 'env-key';
      process.env.OPENAI_BASE_URL = 'https://env.base/v1';
      const cfg = manager.getProviderConfig('openai');
      // stored key > env var key
      assert.equal(cfg.apiKey, 'stored-key');
      assert.equal(cfg.baseUrl, 'https://env.base/v1');
      assert.equal(cfg.defaultBaseUrl, 'https://api.openai.com/v1');
    } finally {
      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_BASE_URL;
      process.env = originalEnv;
    }
  });

  test('getApiKey resolves per-provider: env > stored > CLI override', () => {
    const originalEnv = { ...process.env };
    try {
      process.env.OPENAI_API_KEY = 'env-openai';
      manager.set('providers.gemini.apiKey', 'stored-gemini');
      assert.equal(manager.getApiKey(null, 'openai'), 'env-openai');
      assert.equal(manager.getApiKey(null, 'gemini'), 'stored-gemini');
      assert.equal(manager.getApiKey('cli-over', 'openai'), 'cli-over');
    } finally {
      delete process.env.OPENAI_API_KEY;
      process.env = originalEnv;
    }
  });

  test('removeProvider refuses builtins', () => {
    assert.throws(() => manager.removeProvider('gemini'), /cannot remove builtin/i);
    assert.throws(() => manager.removeProvider('openai'), /cannot remove builtin/i);
    // custom provider removal works
    manager.set('providers.custom.apiKey', 'k');
    manager.removeProvider('custom');
    const cfg = manager.loadConfig();
    assert.ok(!cfg.providers?.custom);
  });

  test('legacy getApiKey(no providerId) returns active provider key', () => {
    manager.set('activeProvider', 'openai');
    manager.set('providers.openai.apiKey', 'ok');
    assert.equal(manager.getApiKey(), 'ok');
  });
});
