/**
 * Tests for /model add, /model remove, /model clear slash commands
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, test } from 'node:test';
import { executeSlashCommand } from '../src/cli/slash-commands.js';
import { ConfigManager } from '../src/config/manager.js';
import { stripAnsi } from '../src/utils/ansi.js';

function makeTmpConfigMgr() {
  const tmpDir = path.join(
    os.tmpdir(),
    `tai-model-crud-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(tmpDir, { recursive: true });
  return new ConfigManager(tmpDir);
}

function makeContext(configMgr, extraOrchestrator = {}) {
  const output = new PassThrough();
  let written = '';
  output.on('data', (c) => {
    written += c.toString();
  });
  const orchestrator = {
    provider: 'gemini',
    llmClient: { getModel: () => 'gemini-2.5-flash', setModel: () => {} },
    ...extraOrchestrator,
  };
  return {
    output,
    get written() {
      return written;
    },
    context: { configMgr, orchestrator, stream: output },
  };
}

describe('/model add', () => {
  test('adds a model to active provider catalog', async () => {
    const configMgr = makeTmpConfigMgr();
    const { context } = makeContext(configMgr);

    const res = await executeSlashCommand('/model add my-new-model', context);

    assert.strictEqual(res.handled, true);
    assert.strictEqual(res.action, 'model_add');
    const catalog = configMgr.getModelCatalog('gemini');
    assert.ok(catalog.includes('my-new-model'));
  });

  test('adds multiple comma-separated models', async () => {
    const configMgr = makeTmpConfigMgr();
    const { context } = makeContext(configMgr);

    await executeSlashCommand('/model add alpha,beta,gamma', context);

    const catalog = configMgr.getModelCatalog('gemini');
    assert.ok(catalog.includes('alpha'));
    assert.ok(catalog.includes('beta'));
    assert.ok(catalog.includes('gamma'));
  });

  test('adds model to a specific provider via --provider flag', async () => {
    const configMgr = makeTmpConfigMgr();
    // Seed openai provider
    const cfg = configMgr.loadConfig();
    cfg.providers.openai = { adapter: 'openai' };
    configMgr.saveConfig(cfg);

    const { context } = makeContext(configMgr, { provider: 'gemini' });

    await executeSlashCommand('/model add gpt-4-turbo --provider openai', context);

    const catalog = configMgr.getModelCatalog('openai');
    assert.ok(catalog.includes('gpt-4-turbo'));
  });

  test('/model add without name outputs error and handled:true', async () => {
    const configMgr = makeTmpConfigMgr();
    const output = new PassThrough();
    let written = '';
    output.on('data', (c) => {
      written += c.toString();
    });
    const { context } = makeContext(configMgr);
    // Override the stream on context to capture output
    context.stream = output;

    const res = await executeSlashCommand('/model add', context);

    assert.strictEqual(res.handled, true);
    assert.ok(written.length > 0, 'should output something');
  });
});

describe('/model remove', () => {
  test('removes a model from active provider catalog', async () => {
    const configMgr = makeTmpConfigMgr();
    // Add a non-active model first
    configMgr.addProviderModels('gemini', 'gemini-1.5-pro');
    const { context } = makeContext(configMgr);

    const res = await executeSlashCommand('/model remove gemini-1.5-pro', context);

    assert.strictEqual(res.handled, true);
    assert.strictEqual(res.action, 'model_remove');
  });

  test('refuses to remove the active model', async () => {
    const configMgr = makeTmpConfigMgr();
    // Pre-seed catalog with the active model present in models[] so removeProviderModels can find it
    const cfg = configMgr.loadConfig();
    cfg.providers.gemini = { adapter: 'gemini', models: ['gemini-2.5-flash', 'gemini-1.5-pro'] };
    configMgr.saveConfig(cfg);
    // Use plain mock so writes are captured synchronously
    let written = '';
    const mockStream = {
      write(chunk) {
        written += typeof chunk === 'string' ? chunk : chunk.toString();
        return true;
      },
    };
    const mockOrchestrator = {
      provider: 'gemini',
      llmClient: { getModel: () => 'gemini-2.5-flash', setModel: () => {} },
    };
    const context = { configMgr, orchestrator: mockOrchestrator, stream: mockStream };

    // Try to remove the effective active model (builtin default for gemini)
    const res = await executeSlashCommand('/model remove gemini-2.5-flash', context);

    assert.strictEqual(res.handled, true);
    const plain = stripAnsi(written);
    assert.ok(
      plain.includes('active') || plain.includes('Switch'),
      'should mention active model constraint',
    );
  });
});

describe('/model clear', () => {
  test('resets active provider catalog to builtin defaults', async () => {
    const configMgr = makeTmpConfigMgr();
    configMgr.addProviderModels('gemini', 'custom-model-xyz');
    const { context } = makeContext(configMgr);

    const res = await executeSlashCommand('/model clear', context);

    assert.strictEqual(res.handled, true);
    assert.strictEqual(res.action, 'model_clear');
    const catalog = configMgr.getModelCatalog('gemini');
    assert.ok(!catalog.includes('custom-model-xyz'));
  });

  test('clears catalog for specific provider via --provider flag', async () => {
    const configMgr = makeTmpConfigMgr();
    const cfg = configMgr.loadConfig();
    cfg.providers.openai = { adapter: 'openai', models: ['custom-openai-model'] };
    configMgr.saveConfig(cfg);
    const { context } = makeContext(configMgr);

    await executeSlashCommand('/model clear --provider openai', context);

    const catalog = configMgr.getModelCatalog('openai');
    assert.ok(!catalog.includes('custom-openai-model'));
  });
});

describe('/model backward compatibility', () => {
  test('/model (no args) still shows picker/info', async () => {
    const configMgr = makeTmpConfigMgr();
    const { context } = makeContext(configMgr);

    const res = await executeSlashCommand('/model', context);

    assert.ok(
      res.action === 'model_info' || res.action === 'model_changed',
      'existing model_info still works',
    );
  });

  test('/model gemini-2.5-pro still switches model (not treated as subcommand)', async () => {
    const configMgr = makeTmpConfigMgr();
    const mockOrchestrator = {
      provider: 'gemini',
      llmClient: {
        model: 'gemini-2.5-flash',
        getModel() {
          return this.model;
        },
        setModel(m) {
          this.model = m;
        },
      },
      session: { model: 'gemini-2.5-flash' },
    };
    const output = new PassThrough();
    const res = await executeSlashCommand('/model gemini-2.5-pro', {
      configMgr,
      orchestrator: mockOrchestrator,
      stream: output,
    });

    assert.strictEqual(res.action, 'model_changed');
    assert.strictEqual(res.message, 'gemini-2.5-pro');
  });
});
