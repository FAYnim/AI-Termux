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

  // === Phase 1.5: BUILTIN_PROVIDERS.models catalog ===
  test('BUILTIN_PROVIDERS.gemini exposes models array with defaultModel included', () => {
    assert.ok(Array.isArray(BUILTIN_PROVIDERS.gemini.models));
    assert.ok(BUILTIN_PROVIDERS.gemini.models.length >= 3);
    assert.ok(BUILTIN_PROVIDERS.gemini.models.includes(BUILTIN_PROVIDERS.gemini.defaultModel));
  });

  test('BUILTIN_PROVIDERS.openai exposes models array with defaultModel included', () => {
    assert.ok(Array.isArray(BUILTIN_PROVIDERS.openai.models));
    assert.ok(BUILTIN_PROVIDERS.openai.models.length >= 3);
    assert.ok(BUILTIN_PROVIDERS.openai.models.includes(BUILTIN_PROVIDERS.openai.defaultModel));
  });

  test('all builtin models are non-empty strings', () => {
    for (const [pid, builtin] of Object.entries(BUILTIN_PROVIDERS)) {
      for (const m of builtin.models) {
        assert.equal(typeof m, 'string', `${pid}.models contains non-string: ${m}`);
        assert.ok(m.trim().length > 0, `${pid}.models contains empty string`);
      }
    }
  });

  test('getProviderModels returns builtin models for builtin provider without stored config', () => {
    const models = manager.getProviderModels('gemini');
    assert.ok(Array.isArray(models));
    assert.ok(models.length >= 3);
    assert.ok(models.includes('gemini-2.5-flash'));
    // defaultModel should be first
    assert.equal(models[0], BUILTIN_PROVIDERS.gemini.defaultModel);
  });

  test('getProviderModels returns builtin models for openai', () => {
    const models = manager.getProviderModels('openai');
    assert.ok(Array.isArray(models));
    assert.ok(models.includes('gpt-4o-mini'));
    assert.equal(models[0], BUILTIN_PROVIDERS.openai.defaultModel);
  });

  test('getProviderModels returns empty array for unknown provider', () => {
    const models = manager.getProviderModels('nonexistent-provider');
    assert.ok(Array.isArray(models));
    assert.equal(models.length, 0);
  });

  test('getProviderModels merges user-customized models with builtin defaults', () => {
    // Manually inject custom models into stored config
    const cfg = manager.loadConfig();
    if (!cfg.providers) cfg.providers = {};
    if (!cfg.providers.gemini) cfg.providers.gemini = {};
    cfg.providers.gemini.models = ['my-custom-model-a', 'my-custom-model-b'];
    manager.saveConfig(cfg);

    const models = manager.getProviderModels('gemini');
    // Custom models should appear (after default)
    assert.ok(models.includes('my-custom-model-a'));
    assert.ok(models.includes('my-custom-model-b'));
    // Builtin models should still be present
    assert.ok(models.includes('gemini-2.5-flash'));
    assert.ok(models.includes('gemini-2.5-pro'));
    // No duplicates
    assert.equal(models.length, new Set(models).size);
  });

  test('getProviderModels deduplicates across stored and builtin lists', () => {
    const cfg = manager.loadConfig();
    if (!cfg.providers) cfg.providers = {};
    cfg.providers.gemini = { models: ['gemini-2.5-flash', 'gemini-extra-1', 'gemini-extra-1', '  '] };
    manager.saveConfig(cfg);

    const models = manager.getProviderModels('gemini');
    // Whitespace-only entry should be filtered out
    assert.ok(!models.includes(''));
    assert.ok(!models.includes('  '));
    // No duplicates
    const counts = models.reduce((acc, m) => { acc[m] = (acc[m] || 0) + 1; return acc; }, {});
    for (const [m, c] of Object.entries(counts)) {
      assert.equal(c, 1, `model "${m}" appears ${c} times`);
    }
  });
  test('setProviderField auto-populates models for builtin provider on first config', () => {
    // Fresh state: no provider config
    manager.setProviderField('openai', 'apiKey', 'test-key-xyz');
    const cfg = manager.loadConfig();
    assert.ok(cfg.providers.openai.models);
    assert.ok(Array.isArray(cfg.providers.openai.models));
    assert.ok(cfg.providers.openai.models.includes('gpt-4o-mini'));
    assert.ok(cfg.providers.openai.models.length >= 3);
  });

  test('setProviderField does NOT overwrite existing user-customized models', () => {
    // Pre-populate custom models
    const cfg = manager.loadConfig();
    cfg.providers = { openai: { models: ['user-model-1', 'user-model-2'] } };
    manager.saveConfig(cfg);

    // Setting another field should not touch models
    manager.setProviderField('openai', 'apiKey', 'another-key');
    const after = manager.loadConfig();
    assert.deepEqual(after.providers.openai.models, ['user-model-1', 'user-model-2']);
  });

  test('setProviderField on custom (non-builtin) provider does not auto-populate models', () => {
    manager.setProviderField('my-custom-llm', 'apiKey', 'custom-key');
    const cfg = manager.loadConfig();
    assert.ok(cfg.providers['my-custom-llm']);
    assert.equal(cfg.providers['my-custom-llm'].models, undefined);
  });
});
