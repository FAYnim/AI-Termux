import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { ConfigManager } from '../src/config/manager.js';

describe('Step 3: Backward compatibility', { concurrency: 1 }, () => {
  let tmpDir;
  let manager;

  beforeEach(() => {
    tmpDir = path.join(
      os.tmpdir(),
      `termuxai-bc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    fs.mkdirSync(tmpDir, { recursive: true });
    manager = new ConfigManager(tmpDir);
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  test('legacy config.json loads without throwing', () => {
    const legacy = { apiKey: 'old-key', model: 'gemini-2.5-flash', timeoutMs: 30000 };
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify(legacy));
    const cfg = manager.loadConfig();
    assert.equal(cfg.activeProvider, 'gemini');
    assert.ok(cfg.providers?.gemini);
    assert.equal(cfg.providers.gemini.apiKey, 'old-key');
  });

  test('activeProvider defaults to gemini when absent', () => {
    const cfg = { timeoutMs: 30000 };
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify(cfg));
    const loaded = manager.loadConfig();
    assert.equal(loaded.activeProvider, 'gemini');
  });

  test('providers block populated after auto-promotion', () => {
    const legacy = { apiKey: 'k1', model: 'gemini-2.5-flash' };
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify(legacy));
    const loaded = manager.loadConfig();
    assert.ok(loaded.providers.gemini);
    assert.equal(loaded.providers.gemini.apiKey, 'k1');
  });
});
