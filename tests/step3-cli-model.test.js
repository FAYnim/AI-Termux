/**
 * Step 3: Non-interactive `tai model ...` CLI Commands
 * Verifies (src/cli/args.js + src/cli/model-commands.js + bin/tai.js):
 *  - args.js: --list, --all, --set flags + `model` command routing
 *  - listModelsCli: list for active provider
 *  - listModelsCli: --all groups all providers
 *  - listModelsCli: --provider <id> targets specific provider
 *  - listModelsCli: unknown provider returns exit code 1
 *  - listModelsCli: missing configMgr returns exit code 1
 *  - setModelCli: persists model via setProviderField
 *  - setModelCli: custom model (not in catalog) is still saved
 *  - setModelCli: missing model arg returns exit code 1
 *  - handleModelCommand: dispatcher routes list/set correctly
 *  - bin/tai.js: model command end-to-end via subprocess
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseArgs } from '../src/cli/args.js';
import { handleModelCommand, listModelsCli, setModelCli } from '../src/cli/model-commands.js';
import { ConfigManager } from '../src/config/manager.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const TAI_BIN = path.join(REPO_ROOT, 'bin', 'tai.js');

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeTmpDir(label) {
  const dir = path.join(
    os.tmpdir(),
    `tai-model-cli-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function stripAnsi(str) {
  return String(str || '').replace(/\x1B\[[0-9;]*m/g, '');
}

// ---------------------------------------------------------------------------
// args.js — flag parsing
// ---------------------------------------------------------------------------

describe('CLI args: Phase 3 model flags', () => {
  test('--list sets flags.modelList=true and routes to model list', () => {
    const res = parseArgs(['model', '--list']);
    assert.equal(res.command, 'model');
    assert.equal(res.subcommand, 'list');
    assert.equal(res.flags.modelList, true);
    assert.equal(res.flags.modelAll, false);
    assert.equal(res.flags.modelSet, null);
  });

  test('--all sets flags.modelAll=true', () => {
    const res = parseArgs(['model', '--list', '--all']);
    assert.equal(res.flags.modelAll, true);
    assert.equal(res.flags.modelList, true);
    assert.equal(res.command, 'model');
  });

  test('--set <name> sets flags.modelSet and routes to model set', () => {
    const res = parseArgs(['model', '--set', 'gemini-2.5-pro']);
    assert.equal(res.command, 'model');
    assert.equal(res.subcommand, 'set');
    assert.equal(res.flags.modelSet, 'gemini-2.5-pro');
  });

  test('--set=<name> (equals form) also parses', () => {
    const res = parseArgs(['model', '--set=gemini-1.5-pro']);
    assert.equal(res.flags.modelSet, 'gemini-1.5-pro');
    assert.equal(res.command, 'model');
  });

  test('bare `model` (no flags) defaults to list subcommand', () => {
    const res = parseArgs(['model']);
    assert.equal(res.command, 'model');
    assert.equal(res.subcommand, 'list');
  });

  test('`models` (plural) also recognized', () => {
    const res = parseArgs(['models', '--list']);
    assert.equal(res.command, 'model');
    assert.equal(res.flags.modelList, true);
  });

  test('flag defaults are sane (modelList=false, modelAll=false, modelSet=null)', () => {
    const res = parseArgs([]);
    assert.equal(res.flags.modelList, false);
    assert.equal(res.flags.modelAll, false);
    assert.equal(res.flags.modelSet, null);
  });

  test('--provider flag still parsed alongside model subcommand', () => {
    const res = parseArgs(['model', '--list', '--provider', 'openai']);
    assert.equal(res.command, 'model');
    assert.equal(res.flags.provider, 'openai');
    assert.equal(res.flags.modelList, true);
  });

  test('--set with empty value does not set flag (skips)', () => {
    const res = parseArgs(['model', '--set', '']);
    // Empty string after trim is filtered out, so modelSet stays null → list
    assert.equal(res.flags.modelSet, null);
    assert.equal(res.subcommand, 'list');
  });
});

// ---------------------------------------------------------------------------
// listModelsCli
// ---------------------------------------------------------------------------

describe('listModelsCli', () => {
  let tmpDir;
  let configMgr;

  before(() => {
    tmpDir = makeTmpDir('list');
    configMgr = new ConfigManager(tmpDir);
  });

  after(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns exit 1 when configMgr is missing', () => {
    const res = listModelsCli({ configMgr: null });
    assert.equal(res.exitCode, 1);
  });

  test('lists models for the active provider (gemini by default)', () => {
    const res = listModelsCli({ configMgr });
    assert.equal(res.exitCode, 0);
    assert.ok(res.output, 'output should be present');
    const clean = stripAnsi(res.output);
    assert.ok(clean.includes('Model (gemini)'), 'output should mention provider');
    assert.ok(clean.includes('gemini-2.5-flash'), 'output should list default model');
    assert.ok(clean.includes('gemini-2.5-pro'), 'output should list other gemini model');
    assert.ok(clean.includes('(active)'), 'active model should be marked');
  });

  test('--all renders all builtin providers in a single box', () => {
    const res = listModelsCli({ configMgr, all: true });
    assert.equal(res.exitCode, 0);
    const clean = stripAnsi(res.output);
    assert.ok(clean.includes('gemini'), 'should list gemini');
    assert.ok(clean.includes('openai'), 'should list openai');
    assert.ok(clean.includes('All Providers'), 'title should mention all providers');
  });

  test('--provider <id> targets a specific provider', () => {
    const res = listModelsCli({ configMgr, providerOverride: 'openai' });
    assert.equal(res.exitCode, 0);
    const clean = stripAnsi(res.output);
    assert.ok(clean.includes('Model (openai)'), 'should target openai');
    assert.ok(clean.includes('gpt-4o-mini'), 'should list openai default');
  });

  test('unknown provider returns exit 1 and a useful error', () => {
    const res = listModelsCli({ configMgr, providerOverride: 'totally-fake-xyz' });
    assert.equal(res.exitCode, 1);
    const clean = stripAnsi(res.output);
    assert.ok(clean.includes('Unknown provider'), 'error should mention unknown');
    assert.ok(clean.includes('totally-fake-xyz'), 'error should mention the bad id');
  });

  test('output is non-empty and uses an ascii box', () => {
    const res = listModelsCli({ configMgr });
    assert.ok(res.output.length > 50, 'output should be substantial');
    // Box chars (round style)
    assert.ok(res.output.includes('╭') || res.output.includes('┌'), 'should have top-left border');
    assert.ok(
      res.output.includes('╰') || res.output.includes('└'),
      'should have bottom-left border',
    );
  });
});

// ---------------------------------------------------------------------------
// setModelCli
// ---------------------------------------------------------------------------

describe('setModelCli', () => {
  let tmpDir;
  let configMgr;

  before(() => {
    tmpDir = makeTmpDir('set');
    configMgr = new ConfigManager(tmpDir);
  });

  after(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('persists model via setProviderField and returns success', () => {
    const res = setModelCli({ configMgr, model: 'gemini-2.5-pro' });
    assert.equal(res.exitCode, 0);
    assert.equal(res.provider, 'gemini');
    assert.equal(res.model, 'gemini-2.5-pro');
    assert.equal(res.inCatalog, true);
    // Verify persistence
    const stored = configMgr.loadConfig();
    assert.equal(stored.providers.gemini.model, 'gemini-2.5-pro');
  });

  test('saves a custom model and auto-includes it in the catalog (inCatalog=true after auto-include)', () => {
    // The user picked a model that was NOT in the builtin catalog.
    // The setModelCli flow goes through setProviderField, which (per the
    // ⭐ ideal patch) auto-injects the new value into `providers[pid].models[]`
    // so that listings like `tai model --list` and `/model` can never lose it.
    const res = setModelCli({ configMgr, model: 'my-custom-finetune-v1' });
    assert.equal(res.exitCode, 0);
    // After auto-include, the model IS in the catalog (the inCatalog check
    // is now evaluated against the *merged* list, which includes the
    // stored active `model` even if the `models[]` array was missing).
    assert.equal(res.inCatalog, true);
    const stored = configMgr.loadConfig();
    assert.equal(stored.providers.gemini.model, 'my-custom-finetune-v1');
    // And it must be present in the stored `models[]` array as well.
    assert.ok(
      Array.isArray(stored.providers.gemini.models) &&
        stored.providers.gemini.models.includes('my-custom-finetune-v1'),
      'custom model should be auto-included in providers[pid].models[]',
    );
  });

  test('explicit --provider override sets model on that provider', () => {
    // First, make sure openai exists in config
    configMgr.setProviderField('openai', 'apiKey', 'test-key-for-openai');
    const res = setModelCli({ configMgr, model: 'gpt-4o', providerOverride: 'openai' });
    assert.equal(res.exitCode, 0);
    assert.equal(res.provider, 'openai');
    const stored = configMgr.loadConfig();
    assert.equal(stored.providers.openai.model, 'gpt-4o');
  });

  test('returns exit 1 when model name is missing or empty', () => {
    const r1 = setModelCli({ configMgr, model: '' });
    assert.equal(r1.exitCode, 1);
    const r2 = setModelCli({ configMgr, model: '   ' });
    assert.equal(r2.exitCode, 1);
    const r3 = setModelCli({ configMgr, model: null });
    assert.equal(r3.exitCode, 1);
  });

  test('returns exit 1 when configMgr is missing', () => {
    const res = setModelCli({ configMgr: null, model: 'foo' });
    assert.equal(res.exitCode, 1);
  });

  test('output contains confirmation and is human-readable', () => {
    const res = setModelCli({ configMgr, model: 'gemini-2.5-flash' });
    const clean = stripAnsi(res.output);
    assert.ok(clean.includes('gemini-2.5-flash'), 'should mention the model');
    assert.ok(clean.includes('gemini'), 'should mention the provider');
  });
});

// ---------------------------------------------------------------------------
// handleModelCommand — dispatcher
// ---------------------------------------------------------------------------

describe('handleModelCommand (dispatcher)', () => {
  let tmpDir;
  let configMgr;

  before(() => {
    tmpDir = makeTmpDir('dispatch');
    configMgr = new ConfigManager(tmpDir);
  });

  after(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('routes to list when subcommand=list', () => {
    const res = handleModelCommand({ command: 'model', subcommand: 'list', flags: {} }, configMgr);
    assert.equal(res.exitCode, 0);
    const clean = stripAnsi(res.output);
    assert.ok(clean.includes('Model ('), 'should be a list output');
  });

  test('routes to set when subcommand=set', () => {
    const res = handleModelCommand(
      { command: 'model', subcommand: 'set', flags: { modelSet: 'gemini-1.5-pro' } },
      configMgr,
    );
    assert.equal(res.exitCode, 0);
    assert.equal(res.model, 'gemini-1.5-pro');
  });

  test('routes to list when subcommand is null but --list flag present', () => {
    const res = handleModelCommand(
      { command: 'model', subcommand: null, flags: { modelList: true } },
      configMgr,
    );
    assert.equal(res.exitCode, 0);
    const clean = stripAnsi(res.output);
    assert.ok(clean.includes('Model ('), 'should be a list output');
  });

  test('fallback to list when subcommand is unknown', () => {
    const res = handleModelCommand({ command: 'model', subcommand: 'weird', flags: {} }, configMgr);
    assert.equal(res.exitCode, 0);
    const clean = stripAnsi(res.output);
    assert.ok(clean.includes('Model ('), 'should fall back to list output');
  });
});

// ---------------------------------------------------------------------------
// bin/tai.js — end-to-end subprocess tests
// ---------------------------------------------------------------------------

describe('bin/tai.js: end-to-end `tai model`', () => {
  let tmpDir;

  before(() => {
    tmpDir = makeTmpDir('e2e');
  });

  after(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function runTai(args) {
    return spawnSync(process.execPath, [TAI_BIN, ...args], {
      env: {
        ...process.env,
        // Force a sandboxed config dir; never touch the real one
        T_AI_CONFIG_DIR: tmpDir,
        TERMUXAI_CONFIG_DIR: tmpDir,
        // Make sure no real key leaks in
        GEMINI_API_KEY: '',
        OPENAI_API_KEY: '',
        TERMUXAI_API_KEY: '',
      },
      encoding: 'utf8',
      timeout: 15000,
    });
  }

  test('`tai model --list` prints the gemini catalog and exits 0', () => {
    const result = runTai(['model', '--list']);
    const clean = stripAnsi(result.stdout + result.stderr);
    assert.equal(
      result.status,
      0,
      `expected exit 0, got ${result.status}; stderr: ${result.stderr}`,
    );
    assert.ok(clean.includes('Model (gemini)'), 'should render gemini catalog box');
    assert.ok(clean.includes('gemini-2.5-flash'), 'should list default model');
  });

  test('`tai model --list --all` includes both builtin providers', () => {
    const result = runTai(['model', '--list', '--all']);
    const clean = stripAnsi(result.stdout + result.stderr);
    assert.equal(result.status, 0);
    assert.ok(clean.includes('gemini'), 'should mention gemini');
    assert.ok(clean.includes('openai'), 'should mention openai');
  });

  test('`tai model --list --provider openai` targets openai', () => {
    const result = runTai(['model', '--list', '--provider', 'openai']);
    const clean = stripAnsi(result.stdout + result.stderr);
    assert.equal(result.status, 0);
    assert.ok(clean.includes('Model (openai)'), 'should target openai');
    assert.ok(clean.includes('gpt-4o-mini'), 'should list openai default');
  });

  test('`tai model --set <m>` persists model and exits 0', () => {
    const result = runTai(['model', '--set', 'gemini-2.5-pro']);
    const clean = stripAnsi(result.stdout + result.stderr);
    assert.equal(
      result.status,
      0,
      `expected exit 0, got ${result.status}; stderr: ${result.stderr}`,
    );
    assert.ok(clean.includes('gemini-2.5-pro'), 'should confirm the new model');
    // Verify persistence on disk
    const configPath = path.join(tmpDir, 'config.json');
    assert.ok(fs.existsSync(configPath), 'config.json should be created');
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(cfg.providers.gemini.model, 'gemini-2.5-pro', 'model should be persisted');
  });

  test('`tai model` (bare) defaults to listing', () => {
    const result = runTai(['model']);
    const clean = stripAnsi(result.stdout + result.stderr);
    assert.equal(result.status, 0);
    assert.ok(clean.includes('Model ('), 'bare `tai model` should list models');
  });

  test('`tai model --list --provider bogus` exits 1 with error', () => {
    const result = runTai(['model', '--list', '--provider', 'bogus-xyz']);
    const clean = stripAnsi(result.stdout + result.stderr);
    assert.equal(result.status, 1);
    assert.ok(clean.includes('Unknown provider'), 'should report unknown provider');
  });

  test('`tai --help` mentions model commands', () => {
    const result = runTai(['--help']);
    const clean = stripAnsi(result.stdout + result.stderr);
    assert.equal(result.status, 0);
    assert.ok(clean.includes('model --list'), 'help should mention model --list');
    assert.ok(clean.includes('model --set'), 'help should mention model --set');
  });
});
