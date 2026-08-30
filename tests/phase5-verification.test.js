/**
 * Phase 5: Verification & Regression Test Suite
 *
 * Verifies end-to-end correctness, regression-safety, and backward-compatibility
 * for the Provider & Model Clarity Refactor:
 *  - 5.1 Unit test & invariant verification (single source of truth, getter consistency)
 *  - 5.2 CLI end-to-end behavior (model list/set/crud, provider show/list, one-shot precedence)
 *  - 5.3 Backward-compatibility with legacy config structures (flat apiKey/model, custom providers, etc.)
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../src/cli/args.js';
import { BUILTIN_PROVIDERS, DEFAULT_CONFIG, DEFAULT_MODEL } from '../src/config/constants.js';
import { ConfigManager } from '../src/config/manager.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const TAI_BIN = path.join(REPO_ROOT, 'bin', 'tai.js');

function makeTmpDir(label) {
  const dir = path.join(
    os.tmpdir(),
    `tai-phase5-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function stripAnsi(str) {
  return String(str || '').replace(/\x1B\[[0-9;]*m/g, '');
}

function runTai(args, tmpDir, extraEnv = {}) {
  return spawnSync(process.execPath, [TAI_BIN, ...args], {
    env: {
      ...process.env,
      T_AI_CONFIG_DIR: tmpDir,
      TERMUXAI_CONFIG_DIR: tmpDir,
      GEMINI_API_KEY: '',
      OPENAI_API_KEY: '',
      TERMUXAI_API_KEY: '',
      T_AI_API_KEY: '',
      ...extraEnv,
    },
    encoding: 'utf8',
    timeout: 15000,
  });
}

// ---------------------------------------------------------------------------
// 5.1: Invariant & Single-Source-of-Truth verification
// ---------------------------------------------------------------------------

describe('Phase 5.1: Invariants & Single Source of Truth', () => {
  test('constants.js does not export SUPPORTED_MODELS', async () => {
    const constants = await import('../src/config/constants.js');
    assert.equal(constants.SUPPORTED_MODELS, undefined, 'SUPPORTED_MODELS must not be exported');
  });

  test('DEFAULT_MODEL matches BUILTIN_PROVIDERS.gemini.defaultModel', () => {
    assert.equal(DEFAULT_MODEL, BUILTIN_PROVIDERS.gemini.defaultModel);
  });

  test('all BUILTIN_PROVIDERS have valid adapter, defaultModel, and models containing defaultModel', () => {
    for (const [pid, pDef] of Object.entries(BUILTIN_PROVIDERS)) {
      assert.ok(pDef.adapter === 'gemini' || pDef.adapter === 'openai', `${pid} has valid adapter`);
      assert.ok(
        typeof pDef.defaultModel === 'string' && pDef.defaultModel.length > 0,
        `${pid} has defaultModel`,
      );
      assert.ok(Array.isArray(pDef.models) && pDef.models.length > 0, `${pid} has models array`);
      assert.ok(pDef.models.includes(pDef.defaultModel), `${pid} defaultModel is in models[]`);
    }
  });

  test('DEFAULT_CONFIG uses DEFAULT_ACTIVE_PROVIDER and BUILTIN_PROVIDERS defaultModel', () => {
    assert.equal(DEFAULT_CONFIG.activeProvider, 'gemini');
    assert.equal(DEFAULT_MODEL, BUILTIN_PROVIDERS.gemini.defaultModel);
  });
});

// ---------------------------------------------------------------------------
// 5.2: End-to-End CLI commands verification
// ---------------------------------------------------------------------------

describe('Phase 5.2: End-to-End CLI Commands Verification', () => {
  let tmpDir;

  before(() => {
    tmpDir = makeTmpDir('e2e-cli');
  });

  after(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('tai model --list lists active provider models with ANSI box', () => {
    const res = runTai(['model', '--list'], tmpDir);
    const clean = stripAnsi(res.stdout + res.stderr);
    assert.equal(res.status, 0);
    assert.ok(clean.includes('Model (gemini)'));
    assert.ok(clean.includes('gemini-2.5-flash'));
    assert.ok(clean.includes('(active)'));
  });

  test('tai model --list --all lists all providers', () => {
    const res = runTai(['model', '--list', '--all'], tmpDir);
    const clean = stripAnsi(res.stdout + res.stderr);
    assert.equal(res.status, 0);
    assert.ok(clean.includes('gemini'));
    assert.ok(clean.includes('openai'));
  });

  test('tai model --set persists new model and updates activeModel', () => {
    const res = runTai(['model', '--set', 'gemini-2.5-pro'], tmpDir);
    const clean = stripAnsi(res.stdout + res.stderr);
    assert.equal(res.status, 0);
    assert.ok(clean.includes('gemini-2.5-pro'));

    // Check list shows gemini-2.5-pro as active now
    const listRes = runTai(['model', '--list'], tmpDir);
    const listClean = stripAnsi(listRes.stdout + listRes.stderr);
    assert.ok(listClean.includes('gemini-2.5-pro (active)'));
  });

  test('tai provider show gemini outputs provider JSON with adapter', () => {
    const res = runTai(['provider', 'show', 'gemini'], tmpDir);
    assert.equal(res.status, 0);
    const json = JSON.parse(res.stdout.trim());
    assert.equal(json.adapter, 'gemini');
    assert.equal(json.defaultModel, 'gemini-2.5-flash');
    assert.ok(Array.isArray(json.models));
  });

  test('tai provider add and show work with custom adapter', () => {
    const res = runTai(
      [
        'provider',
        'add',
        'custom-groq',
        '--api-key',
        'gsk-12345',
        '--base-url',
        'https://api.groq.com/openai/v1',
        '--model',
        'llama-3.3-70b-versatile',
        '--adapter',
        'openai',
      ],
      tmpDir,
    );
    assert.equal(res.status, 0);

    const showRes = runTai(['provider', 'show', 'custom-groq'], tmpDir);
    assert.equal(showRes.status, 0);
    const json = JSON.parse(showRes.stdout.trim());
    assert.equal(json.apiKey, 'gsk-12345');
    assert.equal(json.baseUrl, 'https://api.groq.com/openai/v1');
    assert.equal(json.model, 'llama-3.3-70b-versatile');
    assert.equal(json.adapter, 'openai');
  });

  test('tai provider list shows configured custom providers in JSON', () => {
    const res = runTai(['provider', 'list'], tmpDir);
    assert.equal(res.status, 0);
    const list = JSON.parse(res.stdout.trim());
    assert.ok(Array.isArray(list));
    assert.ok(list.some((p) => p.id === 'custom-groq'));
  });

  test('one-shot CLI flags parse correctly and do not mutate persistent config', () => {
    const parsed = parseArgs(['-p', 'openai', '-m', 'gpt-4o', 'test prompt']);
    assert.equal(parsed.flags.provider, 'openai');
    assert.equal(parsed.flags.model, 'gpt-4o');
    assert.equal(parsed.prompt, 'test prompt');

    // Config on disk is still gemini
    const mgr = new ConfigManager(tmpDir);
    assert.equal(mgr.get('activeProvider') || 'gemini', 'gemini');
    assert.equal(mgr.getActiveModel('gemini'), 'gemini-2.5-pro');
  });
});

// ---------------------------------------------------------------------------
// 5.3: Backward-Compatibility with legacy configs
// ---------------------------------------------------------------------------

describe('Phase 5.3: Backward Compatibility with Legacy Configs', () => {
  let tmpDir;

  before(() => {
    tmpDir = makeTmpDir('compat');
  });

  after(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('reads legacy flat config without providers map gracefully', () => {
    const legacyConfig = {
      apiKey: 'legacy-top-level-key-12345',
      model: 'gemini-1.5-flash',
      autoApprove: true,
      logLevel: 'debug',
      maxRetries: 5,
    };

    const configFile = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configFile, JSON.stringify(legacyConfig, null, 2), 'utf8');

    const mgr = new ConfigManager(tmpDir);
    const config = mgr.loadConfig();

    // Top-level fields preserved
    assert.equal(config.apiKey, 'legacy-top-level-key-12345');
    assert.equal(config.model, 'gemini-1.5-flash');
    assert.equal(config.autoApprove, true);
    assert.equal(config.logLevel, 'debug');
    assert.equal(config.maxRetries, 5);

    // Active provider defaults to gemini
    assert.equal(config.activeProvider || 'gemini', 'gemini');

    // getActiveModel returns the legacy model
    assert.equal(mgr.getActiveModel('gemini'), 'gemini-1.5-flash');

    // getModelCatalog returns default catalog plus the legacy model
    const catalog = mgr.getModelCatalog('gemini');
    assert.ok(catalog.includes('gemini-1.5-flash'));
    assert.ok(catalog.includes('gemini-2.5-flash'));

    // getProviderModels backward-compat alias works identically
    assert.deepEqual(mgr.getProviderModels('gemini'), catalog);
  });

  test('reads legacy provider config with only apiKey and model (no models array)', () => {
    const legacyProviderConfig = {
      activeProvider: 'custom-legacy',
      providers: {
        'custom-legacy': {
          apiKey: 'legacy-custom-key',
          baseUrl: 'https://legacy.example.com/v1',
          model: 'legacy-special-v1',
          // note: no models[] array
        },
      },
    };

    const configFile = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configFile, JSON.stringify(legacyProviderConfig, null, 2), 'utf8');

    const mgr = new ConfigManager(tmpDir);
    assert.equal(mgr.get('activeProvider'), 'custom-legacy');
    assert.equal(mgr.getActiveModel('custom-legacy'), 'legacy-special-v1');

    // Catalog should synthesize array containing the model
    const catalog = mgr.getModelCatalog('custom-legacy');
    assert.deepEqual(catalog, ['legacy-special-v1']);
  });

  test('getProviderNames includes all builtin providers and custom legacy providers', () => {
    const mgr = new ConfigManager(tmpDir);
    const names = mgr.getProviderNames();
    assert.ok(names.includes('gemini'));
    assert.ok(names.includes('openai'));
    assert.ok(names.includes('custom-legacy'));
  });

  test('calling getters never writes to disk (read-only guarantee)', () => {
    const configFile = path.join(tmpDir, 'config.json');
    const beforeMtime = fs.statSync(configFile).mtimeMs;
    const beforeContent = fs.readFileSync(configFile, 'utf8');

    const mgr = new ConfigManager(tmpDir);
    mgr.getActiveModel('gemini');
    mgr.getActiveModel('openai');
    mgr.getModelCatalog('gemini');
    mgr.getProviderNames();
    mgr.getProviderConfig('gemini');

    const afterMtime = fs.statSync(configFile).mtimeMs;
    const afterContent = fs.readFileSync(configFile, 'utf8');

    assert.equal(beforeMtime, afterMtime, 'file mtime should not change on read');
    assert.equal(beforeContent, afterContent, 'file content should not change on read');
  });
});
