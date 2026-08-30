/**
 * Phase 1.4 — Tests: Single Source of Truth
 *
 * Memverifikasi tiga hal utama sesuai REFACTOR_PROVIDER_MODEL_CLARITY.md §1.4:
 *   1. `BUILTIN_PROVIDERS[*].defaultModel` ⊆ `BUILTIN_PROVIDERS[*].models[]` (semua provider)
 *   2. `SUPPORTED_MODELS` TIDAK lagi di-export dari `constants.js`
 *   3. `getProviderModels()` tetap backward-compatible setelah refactor
 *   4. `getProviderNames()` sebagai single source of truth untuk daftar provider
 */

import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import * as constants from '../src/config/constants.js';
import { BUILTIN_PROVIDERS, DEFAULT_MODEL } from '../src/config/constants.js';
import { ConfigManager } from '../src/config/manager.js';

// ---------------------------------------------------------------------------
// 1.4-A  BUILTIN_PROVIDERS invariant: defaultModel ⊆ models[]
// ---------------------------------------------------------------------------
describe('Phase 1.4-A — BUILTIN_PROVIDERS invariant: defaultModel ∈ models[]', () => {
  test('BUILTIN_PROVIDERS is a non-empty object', () => {
    assert.ok(
      typeof BUILTIN_PROVIDERS === 'object' && BUILTIN_PROVIDERS !== null,
      'BUILTIN_PROVIDERS must be an object',
    );
    assert.ok(
      Object.keys(BUILTIN_PROVIDERS).length > 0,
      'BUILTIN_PROVIDERS must have at least one provider',
    );
  });

  // Iterate over every provider dynamically — new providers added to
  // constants.js are automatically covered without editing this test.
  for (const [id, def] of Object.entries(BUILTIN_PROVIDERS)) {
    test(`[${id}] defaultModel is a non-empty string`, () => {
      assert.equal(
        typeof def.defaultModel,
        'string',
        `BUILTIN_PROVIDERS.${id}.defaultModel must be a string`,
      );
      assert.ok(
        def.defaultModel.trim().length > 0,
        `BUILTIN_PROVIDERS.${id}.defaultModel must not be blank`,
      );
    });

    test(`[${id}] models[] is a non-empty array of non-blank strings`, () => {
      assert.ok(Array.isArray(def.models), `BUILTIN_PROVIDERS.${id}.models must be an array`);
      assert.ok(def.models.length > 0, `BUILTIN_PROVIDERS.${id}.models must not be empty`);
      for (const m of def.models) {
        assert.equal(
          typeof m,
          'string',
          `Every entry in BUILTIN_PROVIDERS.${id}.models must be a string`,
        );
        assert.ok(
          m.trim().length > 0,
          `Every entry in BUILTIN_PROVIDERS.${id}.models must be non-blank`,
        );
      }
    });

    test(`[${id}] defaultModel is a member of models[] (single source of truth)`, () => {
      assert.ok(
        def.models.includes(def.defaultModel),
        `BUILTIN_PROVIDERS.${id}.defaultModel ("${def.defaultModel}") ` +
          `must exist in BUILTIN_PROVIDERS.${id}.models (${JSON.stringify(def.models)}). ` +
          `This is the core single-source-of-truth invariant from Phase 1.`,
      );
    });

    test(`[${id}] models[] has no duplicate entries`, () => {
      const unique = new Set(def.models);
      assert.equal(
        unique.size,
        def.models.length,
        `BUILTIN_PROVIDERS.${id}.models must not have duplicates`,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// 1.4-B  SUPPORTED_MODELS tidak lagi di-export dari constants.js
// ---------------------------------------------------------------------------
describe('Phase 1.4-B — SUPPORTED_MODELS tidak lagi di-export dari constants.js', () => {
  test('constants.js does NOT export SUPPORTED_MODELS', () => {
    assert.equal(
      'SUPPORTED_MODELS' in constants,
      false,
      'constants.js must NOT export SUPPORTED_MODELS — it has been removed ' +
        'in Phase 1.1. Use BUILTIN_PROVIDERS[id].models[] instead.',
    );
  });

  test('DEFAULT_MODEL masih di-export sebagai backward-compat bridge', () => {
    assert.equal(
      'DEFAULT_MODEL' in constants,
      true,
      'DEFAULT_MODEL harus tetap di-export untuk backward-compat import',
    );
    assert.equal(typeof DEFAULT_MODEL, 'string');
    assert.ok(DEFAULT_MODEL.trim().length > 0, 'DEFAULT_MODEL must not be blank');
  });

  test('DEFAULT_MODEL sama dengan BUILTIN_PROVIDERS.gemini.defaultModel (bridge tidak drift)', () => {
    assert.equal(
      DEFAULT_MODEL,
      BUILTIN_PROVIDERS.gemini.defaultModel,
      'DEFAULT_MODEL (backward-compat alias) harus selalu sama dengan ' +
        'BUILTIN_PROVIDERS.gemini.defaultModel (sumber kebenaran). ' +
        'Jika tidak sama, update salah satunya.',
    );
  });
});

// ---------------------------------------------------------------------------
// 1.4-C  getProviderModels() backward-compatibility
// ---------------------------------------------------------------------------
describe('Phase 1.4-C — getProviderModels() backward-compatibility', () => {
  /** @returns {ConfigManager} */
  const makeManager = () => {
    const tmpDir = path.join(
      os.tmpdir(),
      `termuxai-ssot-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    return new ConfigManager(tmpDir);
  };

  test('getProviderModels("gemini") returns non-empty array', () => {
    const mgr = makeManager();
    const models = mgr.getProviderModels('gemini');
    assert.ok(Array.isArray(models), 'getProviderModels must return an array');
    assert.ok(models.length > 0, 'getProviderModels("gemini") must not return empty array');
  });

  test('getProviderModels("gemini") includes builtin defaultModel', () => {
    const mgr = makeManager();
    const models = mgr.getProviderModels('gemini');
    assert.ok(
      models.includes(BUILTIN_PROVIDERS.gemini.defaultModel),
      `getProviderModels("gemini") must include defaultModel "${BUILTIN_PROVIDERS.gemini.defaultModel}"`,
    );
  });

  test('getProviderModels("gemini") includes all BUILTIN_PROVIDERS.gemini.models entries', () => {
    const mgr = makeManager();
    const result = mgr.getProviderModels('gemini');
    for (const m of BUILTIN_PROVIDERS.gemini.models) {
      assert.ok(
        result.includes(m),
        `getProviderModels("gemini") must include builtin model "${m}"`,
      );
    }
  });

  test('getProviderModels returns no duplicates', () => {
    const mgr = makeManager();
    for (const id of Object.keys(BUILTIN_PROVIDERS)) {
      const result = mgr.getProviderModels(id);
      const unique = new Set(result);
      assert.equal(
        unique.size,
        result.length,
        `getProviderModels("${id}") must not return duplicate entries`,
      );
    }
  });

  test('getProviderModels includes stored active model even if not in builtin catalog', () => {
    const mgr = makeManager();
    mgr.setProviderField('gemini', 'model', 'gemini-custom-finetune-v1');
    const models = mgr.getProviderModels('gemini');
    assert.ok(
      models.includes('gemini-custom-finetune-v1'),
      'getProviderModels must always include the stored active model, even if not in builtin catalog',
    );
  });

  test('getProviderModels("openai") returns expected builtin models', () => {
    const mgr = makeManager();
    const models = mgr.getProviderModels('openai');
    for (const m of BUILTIN_PROVIDERS.openai.models) {
      assert.ok(
        models.includes(m),
        `getProviderModels("openai") must include builtin model "${m}"`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 1.4-D  getProviderNames() single source of truth untuk provider list
// ---------------------------------------------------------------------------
describe('Phase 1.4-D — getProviderNames() single source of truth', () => {
  const makeManager = (tmpSuffix = '') => {
    const tmpDir = path.join(
      os.tmpdir(),
      `termuxai-pnames-${Date.now()}-${tmpSuffix}-${Math.random().toString(36).slice(2)}`,
    );
    return new ConfigManager(tmpDir);
  };

  test('getProviderNames() includes all builtin providers', () => {
    const mgr = makeManager('builtin');
    const names = mgr.getProviderNames();
    for (const id of Object.keys(BUILTIN_PROVIDERS)) {
      assert.ok(names.includes(id), `getProviderNames() must include builtin provider "${id}"`);
    }
  });

  test('getProviderNames() returns builtin providers first (in declaration order)', () => {
    const mgr = makeManager('order');
    const names = mgr.getProviderNames();
    const builtinKeys = Object.keys(BUILTIN_PROVIDERS);
    for (let i = 0; i < builtinKeys.length; i++) {
      assert.equal(
        names[i],
        builtinKeys[i],
        `getProviderNames()[${i}] must be "${builtinKeys[i]}" (builtin declaration order)`,
      );
    }
  });

  test('getProviderNames() includes custom providers after builtins, sorted alphabetically', () => {
    const mgr = makeManager('custom');
    mgr.setProviderField('my-custom-llm', 'apiKey', 'sk-test-123');
    mgr.setProviderField('another-custom', 'apiKey', 'sk-test-456');

    const names = mgr.getProviderNames();
    const builtinKeys = Object.keys(BUILTIN_PROVIDERS);

    // All builtins come first
    for (let i = 0; i < builtinKeys.length; i++) {
      assert.equal(names[i], builtinKeys[i]);
    }
    // Custom providers appear after, sorted alphabetically
    const customPart = names.slice(builtinKeys.length);
    assert.ok(
      customPart.includes('another-custom'),
      'custom provider "another-custom" must appear',
    );
    assert.ok(customPart.includes('my-custom-llm'), 'custom provider "my-custom-llm" must appear');
    const sortedCustom = [...customPart].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(customPart, sortedCustom, 'custom providers must be sorted alphabetically');
  });

  test('getProviderNames() returns no duplicates', () => {
    const mgr = makeManager('dedup');
    const names = mgr.getProviderNames();
    const unique = new Set(names);
    assert.equal(unique.size, names.length, 'getProviderNames() must not return duplicates');
  });
});
