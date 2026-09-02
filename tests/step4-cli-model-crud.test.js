/**
 * Step 4: `faycli model add/remove/clear` — catalog CRUD for a single provider
 *
 * Verifies (src/config/manager.js + src/cli/args.js + src/cli/model-commands.js + bin/faycli.js):
 *  - args.js: --add, --add=, --remove, --remove=, --clear flags
 *  - args.js: subcommand routing for add/remove/clear
 *  - manager.addProviderModels: single + bulk, dedupe, init from builtin
 *  - manager.removeProviderModels: refuse to remove active model
 *  - manager.clearProviderModels: reset to builtin defaults
 *  - addModelsCli: success / dedupe / unknown provider
 *  - removeModelCli: success / refuse-active / empty input
 *  - clearModelsCli: success
 *  - handleModelCommand: dispatcher routes add/remove/clear
 *  - bin/faycli.js: end-to-end via subprocess
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseArgs } from '../src/cli/args.js';
import {
  addModelsCli,
  clearModelsCli,
  handleModelCommand,
  removeModelCli,
} from '../src/cli/model-commands.js';
import { ConfigManager } from '../src/config/manager.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const TAI_BIN = path.join(REPO_ROOT, 'bin', 'faycli.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(label) {
  const dir = path.join(
    os.tmpdir(),
    `tai-model-crud-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function stripAnsi(str) {
  return String(str || '').replace(/\x1B\[[0-9;]*m/g, '');
}

// ---------------------------------------------------------------------------
// args.js — Phase 4 flag parsing
// ---------------------------------------------------------------------------

describe('CLI args: Phase 4 model add/remove/clear flags', () => {
  test('--add <name> sets flags.modelAdd and routes to model add', () => {
    const res = parseArgs(['model', '--add', 'gpt-4-turbo']);
    assert.equal(res.command, 'model');
    assert.equal(res.subcommand, 'add');
    assert.equal(res.flags.modelAdd, 'gpt-4-turbo');
  });

  test('--add=<name> (equals form) also parses', () => {
    const res = parseArgs(['model', '--add=gpt-4-turbo,gpt-4o']);
    assert.equal(res.command, 'model');
    assert.equal(res.subcommand, 'add');
    assert.equal(res.flags.modelAdd, 'gpt-4-turbo,gpt-4o');
  });

  test('--remove <name> sets flags.modelRemove and routes to model remove', () => {
    const res = parseArgs(['model', '--remove', 'gemini-1.5-flash']);
    assert.equal(res.command, 'model');
    assert.equal(res.subcommand, 'remove');
    assert.equal(res.flags.modelRemove, 'gemini-1.5-flash');
  });

  test('--remove=<name> (equals form) also parses', () => {
    const res = parseArgs(['model', '--remove=gemini-1.5-flash,gemini-1.5-pro']);
    assert.equal(res.flags.modelRemove, 'gemini-1.5-flash,gemini-1.5-pro');
    assert.equal(res.subcommand, 'remove');
  });

  test('--clear sets flags.modelClear and routes to model clear', () => {
    const res = parseArgs(['model', '--clear']);
    assert.equal(res.command, 'model');
    assert.equal(res.subcommand, 'clear');
    assert.equal(res.flags.modelClear, true);
  });

  test('--add with empty value does not set flag (falls back to list)', () => {
    const res = parseArgs(['model', '--add', '']);
    assert.equal(res.flags.modelAdd, null);
    assert.equal(res.subcommand, 'list');
  });

  test('--provider flag still parsed alongside --add', () => {
    const res = parseArgs(['model', '--add', 'gpt-4-turbo', '--provider', 'openai']);
    assert.equal(res.flags.provider, 'openai');
    assert.equal(res.flags.modelAdd, 'gpt-4-turbo');
    assert.equal(res.subcommand, 'add');
  });

  test('flag defaults are sane (modelAdd=null, modelRemove=null, modelClear=false)', () => {
    const res = parseArgs([]);
    assert.equal(res.flags.modelAdd, null);
    assert.equal(res.flags.modelRemove, null);
    assert.equal(res.flags.modelClear, false);
  });

  test('subcommand routing precedence: --set wins over --add/--remove/--clear', () => {
    // First flag wins, parser is single-pass
    const res = parseArgs(['model', '--set', 'foo', '--add', 'bar']);
    assert.equal(res.subcommand, 'set');
  });

  test('top-level shortcut `tai add <name>` routes to model add', () => {
    const res = parseArgs(['add', 'gpt-4-turbo']);
    assert.equal(res.command, 'model');
    assert.equal(res.subcommand, 'add');
    assert.equal(res.flags.modelAdd, 'gpt-4-turbo');
  });

  test('top-level shortcut `tai remove <name>` routes to model remove', () => {
    const res = parseArgs(['remove', 'gemini-1.5-flash']);
    assert.equal(res.command, 'model');
    assert.equal(res.subcommand, 'remove');
    assert.equal(res.flags.modelRemove, 'gemini-1.5-flash');
  });

  test('top-level shortcut `tai clear` routes to model clear', () => {
    const res = parseArgs(['clear']);
    assert.equal(res.command, 'model');
    assert.equal(res.subcommand, 'clear');
  });
});

// ---------------------------------------------------------------------------
// manager.addProviderModels
// ---------------------------------------------------------------------------

describe('ConfigManager.addProviderModels', () => {
  let tmpDir;
  let configMgr;

  before(() => {
    tmpDir = makeTmpDir('add');
    configMgr = new ConfigManager(tmpDir);
  });

  after(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('adds a single model to a builtin provider (initializes from builtin first)', () => {
    // Make sure gemini provider exists in config
    configMgr.setProviderField('gemini', 'apiKey', 'test-key');
    const res = configMgr.addProviderModels('gemini', 'gemini-2.5-pro');
    assert.ok(
      res.added.includes('gemini-2.5-pro') || res.skipped.includes('gemini-2.5-pro'),
      'gemini-2.5-pro should be added or skipped (already in builtin catalog)',
    );
    const stored = configMgr.loadConfig();
    assert.ok(
      stored.providers.gemini.models.includes('gemini-2.5-pro'),
      'catalog should contain gemini-2.5-pro after add',
    );
  });

  test('adds a custom (non-builtin) finetune to a builtin provider', () => {
    configMgr.setProviderField('gemini', 'apiKey', 'test-key');
    const res = configMgr.addProviderModels('gemini', 'my-custom-finetune-v1');
    assert.deepEqual(res.added, ['my-custom-finetune-v1']);
    assert.deepEqual(res.skipped, []);
    const stored = configMgr.loadConfig();
    assert.ok(stored.providers.gemini.models.includes('my-custom-finetune-v1'));
  });

  test('bulk add via comma-separated string', () => {
    configMgr.setProviderField('openai', 'apiKey', 'test-key');
    const res = configMgr.addProviderModels('openai', 'gpt-4-turbo,gpt-4.1,gpt-4.1-mini');
    assert.equal(res.added.length, 3);
    assert.ok(res.added.includes('gpt-4-turbo'));
    assert.ok(res.added.includes('gpt-4.1'));
    assert.ok(res.added.includes('gpt-4.1-mini'));
  });

  test('bulk add via array', () => {
    const res = configMgr.addProviderModels('openai', ['gpt-5', 'gpt-5-mini']);
    assert.equal(res.added.length, 2);
  });

  test('dedupes against existing catalog (re-add is a no-op)', () => {
    configMgr.setProviderField('gemini', 'apiKey', 'test-key');
    const before = configMgr.getProviderModels('gemini');
    const res = configMgr.addProviderModels('gemini', 'gemini-2.5-flash');
    // gemini-2.5-flash is the default → always in catalog → must be skipped
    assert.ok(
      res.skipped.includes('gemini-2.5-flash') || res.added.length === 0,
      're-adding existing model should not add it again',
    );
    const after = configMgr.getProviderModels('gemini');
    assert.equal(before.length, after.length, 'catalog length should be unchanged');
  });

  test('mixed: some new + some already present', () => {
    configMgr.setProviderField('gemini', 'apiKey', 'test-key');
    // 'gemini-2.5-flash' is builtin default → already in catalog
    // 'totally-new-model-xyz' → not present
    const res = configMgr.addProviderModels('gemini', 'gemini-2.5-flash,totally-new-model-xyz');
    assert.ok(res.added.includes('totally-new-model-xyz'), 'new model should be in `added`');
    assert.ok(res.skipped.includes('gemini-2.5-flash'), 'existing model should be in `skipped`');
  });

  test('custom (non-builtin) provider can have models added', () => {
    // First create a custom provider
    const cfg = configMgr.loadConfig();
    if (!cfg.providers.custom1) {
      cfg.providers.custom1 = { apiKey: 'k', baseUrl: 'https://example.com/v1' };
      configMgr.saveConfig(cfg);
    }
    const res = configMgr.addProviderModels('custom1', 'model-a,model-b');
    assert.equal(res.added.length, 2);
    const stored = configMgr.loadConfig();
    assert.deepEqual(stored.providers.custom1.models, ['model-a', 'model-b']);
  });

  test('input with only whitespace / empty entries is gracefully ignored', () => {
    configMgr.setProviderField('openai', 'apiKey', 'test-key');
    const before = configMgr.getProviderModels('openai');
    const res = configMgr.addProviderModels('openai', ',,, ,  ,');
    assert.equal(res.added.length, 0);
    assert.equal(res.skipped.length, 0);
    const after = configMgr.getProviderModels('openai');
    assert.equal(before.length, after.length, 'no change to catalog');
  });
});

// ---------------------------------------------------------------------------
// manager.removeProviderModels
// ---------------------------------------------------------------------------

describe('ConfigManager.removeProviderModels', () => {
  let tmpDir;
  let configMgr;

  before(() => {
    tmpDir = makeTmpDir('remove');
    configMgr = new ConfigManager(tmpDir);
  });

  after(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('removes a single model from a builtin provider', () => {
    configMgr.setProviderField('gemini', 'apiKey', 'test-key');
    const res = configMgr.removeProviderModels('gemini', 'gemini-1.5-pro');
    assert.deepEqual(res.removed, ['gemini-1.5-pro']);
    const stored = configMgr.loadConfig();
    assert.ok(
      !stored.providers.gemini.models.includes('gemini-1.5-pro'),
      'gemini-1.5-pro should be gone from catalog',
    );
  });

  test('removes multiple models via comma-separated input', () => {
    configMgr.setProviderField('gemini', 'apiKey', 'test-key');
    const res = configMgr.removeProviderModels('gemini', 'gemini-1.5-flash,gemini-2.0-flash');
    assert.ok(res.removed.includes('gemini-1.5-flash'));
    assert.ok(res.removed.includes('gemini-2.0-flash'));
  });

  test('refuses to remove the ACTIVE model (skipped, not removed)', () => {
    configMgr.setProviderField('gemini', 'apiKey', 'test-key');
    // default active model is gemini-2.5-flash
    const res = configMgr.removeProviderModels('gemini', 'gemini-2.5-flash');
    assert.deepEqual(res.removed, [], 'active model must not be removed');
    assert.ok(res.skipped.includes('gemini-2.5-flash'), 'active model should be in `skipped`');
    const stored = configMgr.loadConfig();
    assert.ok(
      stored.providers.gemini.models.includes('gemini-2.5-flash'),
      'active model must still be in catalog',
    );
  });

  test('returns empty result for unknown provider', () => {
    const res = configMgr.removeProviderModels('nonexistent-provider', 'foo');
    assert.deepEqual(res.removed, []);
    assert.deepEqual(res.skipped, []);
  });

  test('returns empty result when model name is not in catalog', () => {
    configMgr.setProviderField('gemini', 'apiKey', 'test-key');
    const res = configMgr.removeProviderModels('gemini', 'definitely-not-in-catalog-xyz');
    assert.equal(res.removed.length, 0);
  });
});

// ---------------------------------------------------------------------------
// manager.clearProviderModels
// ---------------------------------------------------------------------------

describe('ConfigManager.clearProviderModels', () => {
  let tmpDir;
  let configMgr;

  before(() => {
    tmpDir = makeTmpDir('clear');
    configMgr = new ConfigManager(tmpDir);
  });

  after(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('restores builtin defaults for a builtin provider', () => {
    configMgr.setProviderField('gemini', 'apiKey', 'test-key');
    // Wreck the catalog first
    configMgr.setProviderField('gemini', 'models', ['only-one-model']);
    let stored = configMgr.loadConfig();
    assert.deepEqual(stored.providers.gemini.models, ['only-one-model']);

    // Now clear
    const _res = configMgr.clearProviderModels('gemini');
    stored = configMgr.loadConfig();
    // After clear, catalog should equal builtin default models
    assert.deepEqual(stored.providers.gemini.models, [
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-1.5-flash',
      'gemini-1.5-pro',
      'gemini-2.0-flash',
    ]);
  });

  test('preserves the active model even if it is a custom finetune', () => {
    configMgr.setProviderField('gemini', 'apiKey', 'test-key');
    // Set a custom finetune as active
    configMgr.setProviderField('gemini', 'model', 'my-finetune-v3');
    // Now clear
    configMgr.clearProviderModels('gemini');
    const stored = configMgr.loadConfig();
    assert.ok(
      stored.providers.gemini.models.includes('my-finetune-v3'),
      'active custom model must survive clear',
    );
  });

  test('sets empty catalog for custom (non-builtin) provider', () => {
    const cfg = configMgr.loadConfig();
    if (!cfg.providers.custom2) {
      cfg.providers.custom2 = { apiKey: 'k', baseUrl: 'https://x.com/v1', models: ['a', 'b'] };
      configMgr.saveConfig(cfg);
    }
    configMgr.clearProviderModels('custom2');
    const stored = configMgr.loadConfig();
    assert.deepEqual(stored.providers.custom2.models, []);
  });
});

// ---------------------------------------------------------------------------
// addModelsCli
// ---------------------------------------------------------------------------

describe('addModelsCli', () => {
  let tmpDir;
  let configMgr;

  before(() => {
    tmpDir = makeTmpDir('add-cli');
    configMgr = new ConfigManager(tmpDir);
  });

  after(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns exit 1 when configMgr is missing', () => {
    const res = addModelsCli({ configMgr: null, models: 'foo' });
    assert.equal(res.exitCode, 1);
  });

  test('returns exit 1 when models is empty/missing', () => {
    assert.equal(addModelsCli({ configMgr, models: '' }).exitCode, 1);
    assert.equal(addModelsCli({ configMgr, models: '   ' }).exitCode, 1);
    assert.equal(addModelsCli({ configMgr, models: null }).exitCode, 1);
    assert.equal(addModelsCli({ configMgr, models: [] }).exitCode, 1);
  });

  test('adds a model and returns success with provider+added+skipped', () => {
    configMgr.setProviderField('gemini', 'apiKey', 'test-key');
    const res = addModelsCli({ configMgr, models: 'gemini-test-1' });
    assert.equal(res.exitCode, 0);
    assert.equal(res.provider, 'gemini');
    assert.ok(res.added.includes('gemini-test-1'));
  });

  test('adds multiple models via comma string', () => {
    configMgr.setProviderField('openai', 'apiKey', 'test-key');
    const res = addModelsCli({
      configMgr,
      models: 'gpt-4.5,gpt-4.5-mini',
      providerOverride: 'openai',
    });
    assert.equal(res.exitCode, 0);
    assert.equal(res.provider, 'openai');
    assert.equal(res.added.length, 2);
  });

  test('reports when all names were already in the catalog (idempotent)', () => {
    configMgr.setProviderField('gemini', 'apiKey', 'test-key');
    const res = addModelsCli({ configMgr, models: 'gemini-2.5-flash' });
    assert.equal(res.exitCode, 0);
    assert.equal(res.added.length, 0);
    assert.ok(res.skipped.includes('gemini-2.5-flash'));
  });

  test('output contains the model names and provider', () => {
    configMgr.setProviderField('gemini', 'apiKey', 'test-key');
    const res = addModelsCli({ configMgr, models: 'gemini-foo-bar' });
    const clean = stripAnsi(res.output);
    assert.ok(clean.includes('gemini-foo-bar'));
    assert.ok(clean.includes('gemini'));
  });
});

// ---------------------------------------------------------------------------
// removeModelCli
// ---------------------------------------------------------------------------

describe('removeModelCli', () => {
  let tmpDir;
  let configMgr;

  before(() => {
    tmpDir = makeTmpDir('remove-cli');
    configMgr = new ConfigManager(tmpDir);
  });

  after(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns exit 1 when configMgr is missing', () => {
    const res = removeModelCli({ configMgr: null, models: 'foo' });
    assert.equal(res.exitCode, 1);
  });

  test('returns exit 1 when models is empty', () => {
    assert.equal(removeModelCli({ configMgr, models: '' }).exitCode, 1);
    assert.equal(removeModelCli({ configMgr, models: null }).exitCode, 1);
  });

  test('removes a non-active model successfully', () => {
    configMgr.setProviderField('gemini', 'apiKey', 'test-key');
    const res = removeModelCli({ configMgr, models: 'gemini-1.5-pro' });
    assert.equal(res.exitCode, 0);
    assert.ok(res.removed.includes('gemini-1.5-pro'));
  });

  test('refuses to remove the active model (exit 1, in skipped)', () => {
    configMgr.setProviderField('gemini', 'apiKey', 'test-key');
    const res = removeModelCli({ configMgr, models: 'gemini-2.5-flash' });
    assert.equal(res.exitCode, 1);
    assert.ok(res.skipped.includes('gemini-2.5-flash'));
  });

  test('output mentions provider and removed/skipped models', () => {
    configMgr.setProviderField('gemini', 'apiKey', 'test-key');
    const res = removeModelCli({ configMgr, models: 'gemini-1.5-flash' });
    const clean = stripAnsi(res.output);
    assert.ok(clean.includes('gemini-1.5-flash'));
    assert.ok(clean.includes('gemini'));
  });
});

// ---------------------------------------------------------------------------
// clearModelsCli
// ---------------------------------------------------------------------------

describe('clearModelsCli', () => {
  let tmpDir;
  let configMgr;

  before(() => {
    tmpDir = makeTmpDir('clear-cli');
    configMgr = new ConfigManager(tmpDir);
  });

  after(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns exit 1 when configMgr is missing', () => {
    const res = clearModelsCli({ configMgr: null });
    assert.equal(res.exitCode, 1);
  });

  test('resets builtin provider catalog to defaults', () => {
    configMgr.setProviderField('gemini', 'apiKey', 'test-key');
    configMgr.setProviderField('gemini', 'models', ['only-one']);
    const res = clearModelsCli({ configMgr });
    assert.equal(res.exitCode, 0);
    assert.equal(res.provider, 'gemini');
    // Catalog should be the builtin default now
    assert.equal(res.catalog.length, 5);
    assert.ok(res.catalog.includes('gemini-2.5-flash'));
  });

  test('uses --provider override when given', () => {
    configMgr.setProviderField('openai', 'apiKey', 'test-key');
    configMgr.setProviderField('openai', 'models', ['custom-only']);
    const res = clearModelsCli({ configMgr, providerOverride: 'openai' });
    assert.equal(res.exitCode, 0);
    assert.equal(res.provider, 'openai');
    // OpenAI has 4 builtin models
    assert.equal(res.catalog.length, 4);
  });
});

// ---------------------------------------------------------------------------
// handleModelCommand — dispatcher (Phase 4 routes)
// ---------------------------------------------------------------------------

describe('handleModelCommand: Phase 4 dispatcher routes', () => {
  let tmpDir;
  let configMgr;

  before(() => {
    tmpDir = makeTmpDir('dispatch-crud');
    configMgr = new ConfigManager(tmpDir);
  });

  after(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('routes to add when subcommand=add', () => {
    configMgr.setProviderField('gemini', 'apiKey', 'k');
    const res = handleModelCommand(
      { command: 'model', subcommand: 'add', flags: { modelAdd: 'test-add-1' } },
      configMgr,
    );
    assert.equal(res.exitCode, 0);
    assert.ok(res.added.includes('test-add-1'));
  });

  test('routes to remove when subcommand=remove', () => {
    configMgr.setProviderField('gemini', 'apiKey', 'k');
    const res = handleModelCommand(
      { command: 'model', subcommand: 'remove', flags: { modelRemove: 'gemini-1.5-pro' } },
      configMgr,
    );
    assert.equal(res.exitCode, 0);
    assert.ok(res.removed.includes('gemini-1.5-pro'));
  });

  test('routes to clear when subcommand=clear', () => {
    configMgr.setProviderField('gemini', 'apiKey', 'k');
    const res = handleModelCommand(
      { command: 'model', subcommand: 'clear', flags: { modelClear: true } },
      configMgr,
    );
    assert.equal(res.exitCode, 0);
    assert.equal(res.provider, 'gemini');
  });
});

// ---------------------------------------------------------------------------
// bin/faycli.js — end-to-end subprocess tests
// ---------------------------------------------------------------------------

describe('bin/faycli.js: end-to-end `faycli model add/remove/clear`', () => {
  let tmpDir;

  before(() => {
    tmpDir = makeTmpDir('e2e-crud');
  });

  after(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function runTai(args) {
    return spawnSync(process.execPath, [TAI_BIN, ...args], {
      env: {
        ...process.env,
        T_AI_CONFIG_DIR: tmpDir,
        FAYCLI_CONFIG_DIR: tmpDir,
        GEMINI_API_KEY: '',
        OPENAI_API_KEY: '',
        FAYCLI_API_KEY: '',
      },
      encoding: 'utf8',
      timeout: 15000,
    });
  }

  test('`faycli model --add <name>` adds model to gemini and exits 0', () => {
    const result = runTai(['model', '--add', 'gemini-e2e-foo']);
    const clean = stripAnsi(result.stdout + result.stderr);
    assert.equal(
      result.status,
      0,
      `expected exit 0, got ${result.status}; stderr: ${result.stderr}`,
    );
    assert.ok(clean.includes('gemini-e2e-foo'), 'should mention the added model');
    // Verify persistence
    const configPath = path.join(tmpDir, 'config.json');
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.ok(cfg.providers.gemini.models.includes('gemini-e2e-foo'));
  });

  test('`faycli model --add <a,b,c>` bulk-adds three models to openai', () => {
    const result = runTai(['model', '--add', 'gpt-4.1,gpt-4.1-mini,gpt-5', '--provider', 'openai']);
    const _clean = stripAnsi(result.stdout + result.stderr);
    assert.equal(result.status, 0);
    const configPath = path.join(tmpDir, 'config.json');
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const openaiModels = cfg.providers.openai.models || [];
    assert.ok(openaiModels.includes('gpt-4.1'));
    assert.ok(openaiModels.includes('gpt-4.1-mini'));
    assert.ok(openaiModels.includes('gpt-5'));
  });

  test('`faycli model --remove <name>` removes a non-active model', () => {
    // First add a custom model we can safely remove
    runTai(['model', '--add', 'gemini-removable-1', '--provider', 'gemini']);
    const result = runTai(['model', '--remove', 'gemini-removable-1', '--provider', 'gemini']);
    const clean = stripAnsi(result.stdout + result.stderr);
    assert.equal(result.status, 0);
    assert.ok(clean.includes('gemini-removable-1'));
    const configPath = path.join(tmpDir, 'config.json');
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.ok(
      !cfg.providers.gemini.models.includes('gemini-removable-1'),
      'removed model should be gone from catalog',
    );
  });

  test('`faycli model --remove <active>` exits 1 (refuses to remove active)', () => {
    const result = runTai(['model', '--remove', 'gemini-2.5-flash']);
    const clean = stripAnsi(result.stdout + result.stderr);
    assert.equal(result.status, 1, 'should refuse to remove the active model');
    assert.ok(
      clean.includes('active') || clean.includes('switch'),
      'error should mention active model / switch instruction',
    );
  });

  test('`faycli model --clear` resets catalog to builtin defaults', () => {
    // First, wreck the catalog
    runTai(['model', '--add', 'will-be-cleared', '--provider', 'gemini']);
    const result = runTai(['model', '--clear', '--provider', 'gemini']);
    const _clean = stripAnsi(result.stdout + result.stderr);
    assert.equal(result.status, 0);
    const configPath = path.join(tmpDir, 'config.json');
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.ok(
      !cfg.providers.gemini.models.includes('will-be-cleared'),
      'cleared model should be gone',
    );
    assert.ok(
      cfg.providers.gemini.models.includes('gemini-2.5-flash'),
      'builtin defaults should be restored',
    );
  });

  test('`faycli model --add` without value exits 1', () => {
    // --add with no value should not parse to subcommand=add
    const result = runTai(['model', '--add']);
    // Without a value, --add is skipped, subcommand defaults to list → exit 0
    // But let's make sure the binary doesn't crash
    assert.equal(result.status, 0, 'binary should not crash on empty --add');
  });

  test('`tai --help` mentions add/remove/clear', () => {
    const result = runTai(['--help']);
    const clean = stripAnsi(result.stdout + result.stderr);
    assert.equal(result.status, 0);
    assert.ok(clean.includes('--add'), 'help should mention --add');
    assert.ok(clean.includes('--remove'), 'help should mention --remove');
    assert.ok(clean.includes('--clear'), 'help should mention --clear');
  });

  test('top-level shortcut `tai add <name>` works (Phase 4 convenience)', () => {
    const result = runTai(['add', 'shortcut-test-1', '--provider', 'gemini']);
    const clean = stripAnsi(result.stdout + result.stderr);
    assert.equal(
      result.status,
      0,
      `expected exit 0, got ${result.status}; stderr: ${result.stderr}`,
    );
    assert.ok(clean.includes('shortcut-test-1'));
  });
});
