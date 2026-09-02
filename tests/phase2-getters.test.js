/**
 * Phase 2.1 — Tests: Read-side getter aliases (`getActiveModel`, `getModelCatalog`)
 *
 * Memverifikasi sesuai REFACTOR_PROVIDER_MODEL_CLARITY.md §2.1:
 *   1. `getActiveModel(providerId)` mengembalikan model efektif dengan
 *      precedence: stored.model → envModelVars → builtin.defaultModel
 *   2. `getModelCatalog(providerId)` adalah read-side alias dari
 *      `getProviderModels()` (tetap backward-compat)
 *   3. Format TERSIMPAN di config.json TIDAK berubah (NON-breaking):
 *      - field di `providers[id]` tetap `model` & `models[]`
 *      - field `activeModel` / `catalog` TIDAK ditulis oleh getter
 *   4. Config lama ber-field `model` / `models` legacy tetap terbaca
 *
 * Fase 2.2 (call-site migration) dan 2.3 (deprecation) adalah PR berikutnya
 * — test ini HANYA mengunci kontrak getter, bukan call sites.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';

import { BUILTIN_PROVIDERS } from '../src/config/constants.js';
import { ConfigManager } from '../src/config/manager.js';

// ---------------------------------------------------------------------------
// Test isolation: setiap test pakai config dir sementara supaya tidak
// men-touch ~/.faycli/config.json milik user.
// ---------------------------------------------------------------------------
const tmpDirs = [];
function makeManager(label = '2.1') {
  const dir = path.join(
    os.tmpdir(),
    `faycli-phase21-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  tmpDirs.push(dir);
  return new ConfigManager(dir);
}

after(() => {
  for (const d of tmpDirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch (_) {}
  }
});

// ---------------------------------------------------------------------------
// 2.1-A  getActiveModel() precedence
// ---------------------------------------------------------------------------
describe('Phase 2.1-A — getActiveModel() precedence', () => {
  test('returns builtin.defaultModel when no stored value and no env override', () => {
    // Make sure no envModelVars for gemini are set in the test environment
    delete process.env.GEMINI_API_KEY_MODEL; // no-op safety
    const mgr = makeManager('builtin-default');
    const active = mgr.getActiveModel('gemini');
    assert.equal(active, BUILTIN_PROVIDERS.gemini.defaultModel);
  });

  test('returns builtin.defaultModel for openai when no stored value', () => {
    delete process.env.OPENAI_MODEL;
    const mgr = makeManager('openai-builtin');
    const active = mgr.getActiveModel('openai');
    assert.equal(active, BUILTIN_PROVIDERS.openai.defaultModel);
  });

  test('stored.model (user choice) wins over builtin.defaultModel', () => {
    const mgr = makeManager('stored-wins');
    mgr.setProviderField('gemini', 'model', 'gemini-custom-finetune-v1');
    const active = mgr.getActiveModel('gemini');
    assert.equal(active, 'gemini-custom-finetune-v1');
  });

  test('stored.model wins over envModelVars', () => {
    process.env.OPENAI_MODEL = 'gpt-from-env';
    try {
      const mgr = makeManager('stored-vs-env');
      mgr.setProviderField('openai', 'model', 'gpt-stored');
      const active = mgr.getActiveModel('openai');
      assert.equal(active, 'gpt-stored');
    } finally {
      delete process.env.OPENAI_MODEL;
    }
  });

  test('envModelVars used when no stored.model (openai OPENAI_MODEL)', () => {
    process.env.OPENAI_MODEL = 'gpt-from-env';
    try {
      const mgr = makeManager('env-wins-default');
      const active = mgr.getActiveModel('openai');
      assert.equal(active, 'gpt-from-env');
    } finally {
      delete process.env.OPENAI_MODEL;
    }
  });

  test('whitespace-only stored.model is ignored (falls through to env/builtin)', () => {
    process.env.OPENAI_MODEL = 'gpt-from-env-clean';
    try {
      const mgr = makeManager('whitespace-stored');
      // Force-write whitespace via the public API by going around setProviderField,
      // which strips empty values. We write directly to disk to simulate a
      // hand-edited config from a user.
      const cfg = mgr.loadConfig();
      cfg.providers = cfg.providers || {};
      cfg.providers.openai = { ...(cfg.providers.openai || {}), model: '   ' };
      mgr.saveConfig(cfg);

      const active = mgr.getActiveModel('openai');
      assert.equal(active, 'gpt-from-env-clean');
    } finally {
      delete process.env.OPENAI_MODEL;
    }
  });

  test('returns null for unknown provider with no stored entry', () => {
    const mgr = makeManager('unknown');
    const active = mgr.getActiveModel('nonexistent-llm-xyz');
    assert.equal(active, null);
  });

  test('returns stored.model for unknown/custom provider (no builtin to fall back to)', () => {
    const mgr = makeManager('custom-stored');
    mgr.setProviderField('my-llm', 'apiKey', 'sk-test');
    mgr.setProviderField('my-llm', 'model', 'my-llm-7b-chat');
    const active = mgr.getActiveModel('my-llm');
    assert.equal(active, 'my-llm-7b-chat');
  });

  test('envModelVars are iterated in declaration order (first non-empty wins)', () => {
    // openai has only OPENAI_MODEL in envModelVars; sanity check single-var case.
    process.env.OPENAI_MODEL = '  spaced-gpt  ';
    try {
      const mgr = makeManager('env-trim');
      const active = mgr.getActiveModel('openai');
      assert.equal(active, 'spaced-gpt', 'getActiveModel must trim env-var values');
    } finally {
      delete process.env.OPENAI_MODEL;
    }
  });
});

// ---------------------------------------------------------------------------
// 2.1-B  getModelCatalog() is a read-side alias of getProviderModels()
// ---------------------------------------------------------------------------
describe('Phase 2.1-B — getModelCatalog() = getProviderModels() (read-side alias)', () => {
  test('getModelCatalog("gemini") returns non-empty array', () => {
    const mgr = makeManager('catalog-basic');
    const catalog = mgr.getModelCatalog('gemini');
    assert.ok(Array.isArray(catalog));
    assert.ok(catalog.length > 0);
  });

  test('getModelCatalog("gemini") matches getProviderModels("gemini") exactly', () => {
    const mgr = makeManager('catalog-equiv');
    const a = mgr.getModelCatalog('gemini');
    const b = mgr.getProviderModels('gemini');
    assert.deepEqual(a, b, 'getModelCatalog must be a read-side alias of getProviderModels');
  });

  test('getModelCatalog("openai") matches getProviderModels("openai") exactly', () => {
    const mgr = makeManager('catalog-equiv-openai');
    const a = mgr.getModelCatalog('openai');
    const b = mgr.getProviderModels('openai');
    assert.deepEqual(a, b);
  });

  test('getModelCatalog auto-includes stored active model (custom finetune)', () => {
    const mgr = makeManager('catalog-include-stored');
    mgr.setProviderField('gemini', 'model', 'gemini-custom-finetune-v2');
    const catalog = mgr.getModelCatalog('gemini');
    assert.ok(
      catalog.includes('gemini-custom-finetune-v2'),
      'getModelCatalog must surface the stored active model even outside builtin catalog',
    );
  });

  test('getModelCatalog returns empty array for unknown provider (no stored data)', () => {
    const mgr = makeManager('catalog-unknown');
    const catalog = mgr.getModelCatalog('nonexistent-llm-xyz');
    assert.ok(Array.isArray(catalog));
    assert.equal(catalog.length, 0);
  });

  test('getModelCatalog returns no duplicates', () => {
    const mgr = makeManager('catalog-dedup');
    const catalog = mgr.getModelCatalog('gemini');
    const unique = new Set(catalog);
    assert.equal(unique.size, catalog.length, 'getModelCatalog must not return duplicates');
  });
});

// ---------------------------------------------------------------------------
// 2.1-C  Getter adalah READ-SIDE — TIDAK menulis field baru ke config
// ---------------------------------------------------------------------------
describe('Phase 2.1-C — Getters are read-side (no new fields written to config)', () => {
  test('calling getActiveModel does NOT add "activeModel" field to stored config', () => {
    const mgr = makeManager('no-write-active');
    mgr.setProviderField('gemini', 'model', 'gemini-2.5-pro');
    mgr.getActiveModel('gemini');
    mgr.getActiveModel('gemini'); // call again — still no side effect

    const cfg = mgr.loadConfig();
    const stored = cfg.providers?.gemini || {};
    assert.equal(
      'activeModel' in stored,
      false,
      'getActiveModel must NOT add an "activeModel" field — the on-disk format ' +
        'remains { model: "..." } for backward compatibility.',
    );
    // Sanity: original `model` field is still there
    assert.equal(stored.model, 'gemini-2.5-pro');
  });

  test('calling getModelCatalog does NOT add "catalog" field to stored config', () => {
    const mgr = makeManager('no-write-catalog');
    mgr.getModelCatalog('gemini');
    mgr.getModelCatalog('gemini');

    const cfg = mgr.loadConfig();
    const stored = cfg.providers?.gemini || {};
    assert.equal(
      'catalog' in stored,
      false,
      'getModelCatalog must NOT add a "catalog" field — the on-disk format ' +
        'remains { models: [...] } for backward compatibility.',
    );
  });

  test('fresh config file is byte-identical before and after getter calls', () => {
    const mgr = makeManager('byte-identical');

    // First call: ensureDirs + save (write DEFAULT_CONFIG). Capture that.
    mgr.loadConfig();
    const path = mgr.getConfigPath();
    const before = fs.readFileSync(path, 'utf8');

    // Hammer the getters — they must be pure reads.
    for (let i = 0; i < 5; i++) {
      mgr.getActiveModel('gemini');
      mgr.getActiveModel('openai');
      mgr.getModelCatalog('gemini');
      mgr.getModelCatalog('openai');
    }

    const after = fs.readFileSync(path, 'utf8');
    assert.equal(after, before, 'config.json must be unchanged after pure getter calls');
  });
});

// ---------------------------------------------------------------------------
// 2.1-D  Backward-compat: config lama (field `model` / `models`) tetap terbaca
// ---------------------------------------------------------------------------
describe('Phase 2.1-D — Backward-compat: legacy config (model / models) masih terbaca', () => {
  test('getActiveModel membaca legacy stored.model (config dengan format lama)', () => {
    const mgr = makeManager('legacy-model');
    mgr.ensureDirs();
    // Tulis config "legacy" secara manual — field `model` (bukan `activeModel`)
    const legacyConfig = {
      activeProvider: 'gemini',
      providers: {
        gemini: {
          apiKey: 'sk-legacy-123',
          model: 'gemini-1.5-pro-legacy', // ← format lama, HARUS tetap terbaca
        },
      },
      timeoutMs: 30000,
      maxContextTokens: 1000000,
      autoConfirm: false,
      verbose: false,
    };
    fs.writeFileSync(mgr.getConfigPath(), JSON.stringify(legacyConfig, null, 2), 'utf8');

    const active = mgr.getActiveModel('gemini');
    assert.equal(
      active,
      'gemini-1.5-pro-legacy',
      'getActiveModel harus tetap membaca stored.model pada config lama',
    );
  });

  test('getModelCatalog membaca legacy stored.models[] (config dengan format lama)', () => {
    const mgr = makeManager('legacy-models');
    mgr.ensureDirs();
    const legacyConfig = {
      activeProvider: 'openai',
      providers: {
        openai: {
          apiKey: 'sk-legacy-456',
          models: ['gpt-4-legacy', 'gpt-3.5-turbo-legacy'], // ← format lama
        },
      },
      timeoutMs: 30000,
      maxContextTokens: 1000000,
      autoConfirm: false,
      verbose: false,
    };
    fs.writeFileSync(mgr.getConfigPath(), JSON.stringify(legacyConfig, null, 2), 'utf8');

    const catalog = mgr.getModelCatalog('openai');
    assert.ok(catalog.includes('gpt-4-legacy'), 'legacy stored.models[] harus tetap terbaca');
    assert.ok(
      catalog.includes('gpt-3.5-turbo-legacy'),
      'legacy stored.models[] harus tetap terbaca',
    );
  });

  test('getProviderModels (legacy API) masih jalan dan hasilnya identik dengan getModelCatalog', () => {
    // Ini mengunci kontrak backward-compat: code lama yang panggil
    // getProviderModels() langsung harus tetap jalan tanpa perubahan.
    const mgr = makeManager('legacy-still-works');
    mgr.setProviderField('gemini', 'model', 'gemini-1.5-flash');
    mgr.setProviderField('gemini', 'models', ['gemini-1.5-flash', 'gemini-2.0-flash-custom']);

    const legacy = mgr.getProviderModels('gemini');
    const modern = mgr.getModelCatalog('gemini');
    assert.deepEqual(legacy, modern, 'getProviderModels() dan getModelCatalog() harus identik');
  });
});

// ---------------------------------------------------------------------------
// 2.1-E  Konsistensi silang: getActiveModel() + getModelCatalog()
//         (active model HARUS masuk catalog — sama seperti invariant Phase 1)
// ---------------------------------------------------------------------------
describe('Phase 2.1-E — Cross-consistency: active model appears in catalog', () => {
  test('stored active model selalu muncul di getModelCatalog (untuk semua provider)', () => {
    const mgr = makeManager('cross-consistency');
    for (const id of Object.keys(BUILTIN_PROVIDERS)) {
      const customName = `${id}-custom-finetune`;
      mgr.setProviderField(id, 'model', customName);

      const active = mgr.getActiveModel(id);
      const catalog = mgr.getModelCatalog(id);

      assert.equal(active, customName);
      assert.ok(
        catalog.includes(customName),
        `getModelCatalog("${id}") harus selalu menyertakan active model "${customName}"`,
      );
    }
  });
});
