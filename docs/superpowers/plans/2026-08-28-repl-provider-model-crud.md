# REPL Provider & Model CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full provider and model CRUD to the REPL via new slash commands (`/provider add` wizard, `/provider remove`, `/provider show`, `/model add`, `/model remove`, `/model clear`) so users never have to leave `termuxai` to configure providers or models.

**Architecture:** A new `src/cli/provider-wizard.js` owns the interactive multi-step wizard for `/provider add`; it returns a plain result object and never writes to config itself. `src/cli/slash-commands.js` receives the wizard result, persists it, and optionally updates the live orchestrator. Model CRUD sub-commands (`add`, `remove`, `clear`) in the `model` case of `slash-commands.js` delegate directly to the existing functions in `model-commands.js` — no new model logic is written.

**Tech Stack:** Node.js >= 18 ESM, `node:readline` (built-in), `node:test` + `node:assert` (built-in test runner). Zero new npm dependencies.

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| **Create** | `src/cli/provider-wizard.js` | Interactive 5-step wizard; pure async function, returns result object |
| **Modify** | `src/cli/slash-commands.js` | Add routing for `provider add/remove/show` and `model add/remove/clear`; add 6 help entries |
| **Create** | `tests/step5-provider-wizard.test.js` | Unit tests for `runProviderAddWizard` (mock readline) |
| **Create** | `tests/step5-slash-model-crud.test.js` | Unit tests for `/model add/remove/clear` via `executeSlashCommand` |
| **Modify** | `tests/step5-piping.test.js` | Add cases for `/provider add` cancel, `/provider remove`, `/provider show` |

**Not touched:** `src/config/manager.js`, `src/cli/model-commands.js`, `src/cli/repl.js`, `bin/tai.js`, `src/config/constants.js`, `src/cli/index.js`.

---

## Background: Key APIs You Will Use

Before writing any code, read these files to understand the existing APIs:

- `src/config/manager.js` — `ConfigManager` class methods used:
  - `loadConfig()` → `{ providers: { [id]: { adapter, apiKey, baseUrl, model, models } }, activeProvider, ... }`
  - `saveConfig(cfg)` — atomic write to disk
  - `set(key, value)` — set top-level config key (e.g. `'activeProvider'`)
  - `getProviderConfig(id)` — merged builtin + stored config; throws if unknown
  - `removeProvider(id)` — deletes custom provider; throws if builtin
  - `get('activeProvider')` → string
- `src/cli/model-commands.js` — functions used:
  - `addModelsCli({ configMgr, models, providerOverride })` → `{ exitCode, output }`
  - `removeModelCli({ configMgr, models, providerOverride })` → `{ exitCode, output }`
  - `clearModelsCli({ configMgr, providerOverride })` → `{ exitCode, output }`
- `src/cli/slash-commands.js` — structure to extend:
  - `SLASH_COMMANDS_HELP` array at top of file
  - `executeSlashCommand(input, context)` — big switch on `command` with `case 'provider'` and `case 'model'`
  - `context` shape: `{ orchestrator, configMgr, stream, input }`
  - In `case 'provider'`: `const action = args[0]` already exists
  - In `case 'model'`: `const newModel = args[0]` currently treats any arg as a model name
- `src/utils/ansi.js` — `ansi.green`, `ansi.yellow`, `ansi.cyan`, `ansi.red`, `ansi.bold`, `ansi.dim`, `ansi.white`
- `src/ui/box.js` — `renderBox(content, { title, borderColor, borderStyle, minWidth })`

---

## Task 1: Create `src/cli/provider-wizard.js` — skeleton + pure helper functions

**Files:**
- Create: `src/cli/provider-wizard.js`

The wizard is a pure async function that uses a `readline.Interface` passed in from the caller (so it can be mocked in tests). It contains two pure helper functions (`isLocalUrl` and `isApiKeyRequired`) that are easy to test without any I/O.

- [x] **Step 1.1: Create the file with helpers and the exported stub**

```js
/**
 * Interactive wizard for /provider add REPL command.
 * Zero new dependencies — uses node:readline (built-in).
 */
import readline from 'node:readline';
import { ansi } from '../utils/ansi.js';

/**
 * Returns true when a base URL points to a local endpoint
 * (Ollama / self-hosted use case — API key is optional).
 * @param {string} url
 * @returns {boolean}
 */
export function isLocalUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const u = url.toLowerCase();
  return u.includes('localhost') || u.includes('127.0.0.1');
}

/**
 * Determines whether an API key is required given the adapter and base URL.
 * @param {'openai'|'gemini'} adapter
 * @param {string} baseUrl  empty string means "use adapter default"
 * @returns {boolean}
 */
export function isApiKeyRequired(adapter, baseUrl) {
  if (adapter === 'gemini') return true;
  // openai: local endpoints (Ollama) don't need a key
  if (isLocalUrl(baseUrl)) return false;
  // openai: everything else (default OpenAI, cloud endpoints) needs a key
  return true;
}

/**
 * Runs the interactive /provider add wizard.
 *
 * Does NOT write to config — returns the result for the caller to persist.
 *
 * @param {object} ctx
 * @param {import('../config/manager.js').ConfigManager} ctx.configMgr
 * @param {NodeJS.WritableStream}  [ctx.stream=process.stdout]
 * @param {NodeJS.ReadableStream}  [ctx.input=process.stdin]
 * @param {string} [ctx.prefilledId]  provider ID already provided via /provider add <id>
 * @returns {Promise<
 *   { cancelled: true } |
 *   { cancelled: false, providerId: string, config: object, switchNow: boolean }
 * >}
 */
export async function runProviderAddWizard(ctx = {}) {
  // Implementation in Task 2
  return { cancelled: true };
}
```

- [x] **Step 1.2: Write failing tests for `isLocalUrl` and `isApiKeyRequired`**

Create `tests/step5-provider-wizard.test.js`:

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isLocalUrl, isApiKeyRequired } from '../src/cli/provider-wizard.js';

describe('provider-wizard: isLocalUrl', () => {
  test('returns true for localhost', () => {
    assert.strictEqual(isLocalUrl('http://localhost:11434/v1'), true);
  });
  test('returns true for 127.0.0.1', () => {
    assert.strictEqual(isLocalUrl('http://127.0.0.1:8080/v1'), true);
  });
  test('returns false for cloud URLs', () => {
    assert.strictEqual(isLocalUrl('https://api.groq.com/openai/v1'), false);
  });
  test('returns false for empty string', () => {
    assert.strictEqual(isLocalUrl(''), false);
  });
  test('returns false for null/undefined', () => {
    assert.strictEqual(isLocalUrl(null), false);
    assert.strictEqual(isLocalUrl(undefined), false);
  });
});

describe('provider-wizard: isApiKeyRequired', () => {
  test('gemini always requires API key', () => {
    assert.strictEqual(isApiKeyRequired('gemini', ''), true);
    assert.strictEqual(isApiKeyRequired('gemini', 'http://localhost/v1'), true);
  });
  test('openai + localhost → optional (Ollama)', () => {
    assert.strictEqual(isApiKeyRequired('openai', 'http://localhost:11434/v1'), false);
  });
  test('openai + 127.0.0.1 → optional', () => {
    assert.strictEqual(isApiKeyRequired('openai', 'http://127.0.0.1:11434/v1'), false);
  });
  test('openai + cloud URL → required', () => {
    assert.strictEqual(isApiKeyRequired('openai', 'https://api.groq.com/openai/v1'), true);
  });
  test('openai + empty (default OpenAI) → required', () => {
    assert.strictEqual(isApiKeyRequired('openai', ''), true);
  });
});
```

- [x] **Step 1.3: Run tests — expect PASS for helpers (stub returns cancelled:true)**

```
node --test tests/step5-provider-wizard.test.js
```

Expected: all `isLocalUrl` and `isApiKeyRequired` tests PASS. The wizard happy-path tests added in Task 3 will fail until Task 2 is done — that's fine, only the helper tests exist now.

- [x] **Step 1.4: Commit**

```bash
git add src/cli/provider-wizard.js tests/step5-provider-wizard.test.js
git commit -m "feat: add provider-wizard skeleton + isLocalUrl/isApiKeyRequired helpers"
```

---

## Task 2: Implement `runProviderAddWizard` — full 5-step wizard

**Files:**
- Modify: `src/cli/provider-wizard.js`

The wizard creates its own `readline.Interface` internally using the `input` and `output` streams from `ctx`. It catches `SIGINT` on the interface to handle Ctrl+C cancellation.

- [x] **Step 2.1: Write failing tests for wizard happy paths and cancellation**

Add these test cases to `tests/step5-provider-wizard.test.js` (after the existing helper tests):

```js
import { PassThrough } from 'node:stream';
import { runProviderAddWizard } from '../src/cli/provider-wizard.js';
import { ConfigManager } from '../src/config/manager.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Helper: build a fake readable input stream from a sequence of answers.
// Each answer maps to one readline.question() call in order.
function makeAnswerStream(answers) {
  const pt = new PassThrough();
  pt.isTTY = false;
  // Feed answers one-by-one on the next tick so readline can read them
  let i = 0;
  const feedNext = () => {
    if (i < answers.length) {
      pt.push(answers[i] + '\n');
      i++;
      setImmediate(feedNext);
    } else {
      pt.push(null); // EOF
    }
  };
  setImmediate(feedNext);
  return pt;
}

function makeTmpConfigMgr() {
  const tmpDir = path.join(os.tmpdir(), `tai-wiz-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  return new ConfigManager(tmpDir);
}

describe('runProviderAddWizard: happy paths', () => {
  test('openai cloud provider (wajib API key + base URL)', async () => {
    // Answers: id, adapter, baseUrl, apiKey, model, switchNow
    const answers = ['groq', 'openai', 'https://api.groq.com/openai/v1', 'gsk_test123', 'llama-3.3-70b', 'n'];
    const input = makeAnswerStream(answers);
    const output = new PassThrough();
    const configMgr = makeTmpConfigMgr();

    const result = await runProviderAddWizard({ configMgr, input, output });

    assert.strictEqual(result.cancelled, false);
    assert.strictEqual(result.providerId, 'groq');
    assert.strictEqual(result.config.adapter, 'openai');
    assert.strictEqual(result.config.baseUrl, 'https://api.groq.com/openai/v1');
    assert.strictEqual(result.config.apiKey, 'gsk_test123');
    assert.strictEqual(result.config.model, 'llama-3.3-70b');
    assert.strictEqual(result.switchNow, false);
  });

  test('gemini provider (base URL step skipped, API key required)', async () => {
    // Answers: id, adapter, [no baseUrl step], apiKey, model, switchNow
    const answers = ['my-gemini', 'gemini', 'AIzaSy_test', '', 'Y'];
    const input = makeAnswerStream(answers);
    const output = new PassThrough();
    const configMgr = makeTmpConfigMgr();

    const result = await runProviderAddWizard({ configMgr, input, output });

    assert.strictEqual(result.cancelled, false);
    assert.strictEqual(result.providerId, 'my-gemini');
    assert.strictEqual(result.config.adapter, 'gemini');
    assert.strictEqual(result.config.baseUrl, undefined);
    assert.strictEqual(result.config.apiKey, 'AIzaSy_test');
    assert.strictEqual(result.switchNow, true);
  });

  test('ollama provider (localhost → API key optional, Enter skips it)', async () => {
    // Answers: id, adapter, baseUrl, apiKey (empty = skip), model (empty = skip), switchNow
    const answers = ['ollama', 'openai', 'http://localhost:11434/v1', '', '', 'n'];
    const input = makeAnswerStream(answers);
    const output = new PassThrough();
    const configMgr = makeTmpConfigMgr();

    const result = await runProviderAddWizard({ configMgr, input, output });

    assert.strictEqual(result.cancelled, false);
    assert.strictEqual(result.providerId, 'ollama');
    assert.strictEqual(result.config.adapter, 'openai');
    assert.strictEqual(result.config.baseUrl, 'http://localhost:11434/v1');
    assert.strictEqual(result.config.apiKey, undefined);
    assert.strictEqual(result.config.model, undefined);
    assert.strictEqual(result.switchNow, false);
  });

  test('switchNow = Y (Enter) returns switchNow: true', async () => {
    const answers = ['deepseek', 'openai', 'https://api.deepseek.com/v1', 'sk_test', '', ''];
    const input = makeAnswerStream(answers);
    const output = new PassThrough();
    const configMgr = makeTmpConfigMgr();

    const result = await runProviderAddWizard({ configMgr, input, output });

    assert.strictEqual(result.cancelled, false);
    assert.strictEqual(result.switchNow, true); // Enter on [Y/n] → true
  });

  test('prefilledId skips Step 1 prompt', async () => {
    // No ID answer needed — already provided
    const answers = ['openai', 'https://api.openrouter.ai/api/v1', 'sk-or-test', '', 'n'];
    const input = makeAnswerStream(answers);
    const output = new PassThrough();
    const configMgr = makeTmpConfigMgr();

    const result = await runProviderAddWizard({ configMgr, input, output, prefilledId: 'openrouter' });

    assert.strictEqual(result.cancelled, false);
    assert.strictEqual(result.providerId, 'openrouter');
  });
});

describe('runProviderAddWizard: validation and error paths', () => {
  test('invalid adapter input → retry, then valid', async () => {
    // First adapter answer is invalid, second is valid
    const answers = ['myprov', 'badadapter', 'openai', 'https://example.com/v1', 'key123', '', 'n'];
    const input = makeAnswerStream(answers);
    const output = new PassThrough();
    let written = '';
    output.on('data', c => { written += c.toString(); });
    const configMgr = makeTmpConfigMgr();

    const result = await runProviderAddWizard({ configMgr, input, output });

    assert.strictEqual(result.cancelled, false);
    assert.ok(written.includes('openai') || written.includes('gemini'), 'should show valid options in error');
  });

  test('empty API key on required field → retry, then valid', async () => {
    // First apiKey answer is empty (should be rejected for cloud), second is valid
    const answers = ['myprov2', 'openai', 'https://api.groq.com/v1', '', 'valid-key', '', 'n'];
    const input = makeAnswerStream(answers);
    const output = new PassThrough();
    let written = '';
    output.on('data', c => { written += c.toString(); });
    const configMgr = makeTmpConfigMgr();

    const result = await runProviderAddWizard({ configMgr, input, output });

    assert.strictEqual(result.cancelled, false);
    assert.strictEqual(result.config.apiKey, 'valid-key');
    assert.ok(written.includes('required') || written.includes('API key'), 'should show error message');
  });

  test('provider ID already exists → confirm overwrite Y → continue', async () => {
    // Pre-seed config with existing provider
    const configMgr = makeTmpConfigMgr();
    const cfg = configMgr.loadConfig();
    cfg.providers = { existingprov: { adapter: 'openai' } };
    configMgr.saveConfig(cfg);

    // Answers: id (existing), overwrite=y, adapter, baseUrl, apiKey, model, switchNow
    const answers = ['existingprov', 'y', 'openai', 'https://api.groq.com/v1', 'newkey', '', 'n'];
    const input = makeAnswerStream(answers);
    const output = new PassThrough();
    const result = await runProviderAddWizard({ configMgr, input, output });

    assert.strictEqual(result.cancelled, false);
    assert.strictEqual(result.providerId, 'existingprov');
  });

  test('provider ID already exists → confirm overwrite N → ask new ID', async () => {
    const configMgr = makeTmpConfigMgr();
    const cfg = configMgr.loadConfig();
    cfg.providers = { existingprov: { adapter: 'openai' } };
    configMgr.saveConfig(cfg);

    // First ID = existing, overwrite = n, second ID = new one
    const answers = ['existingprov', 'n', 'newprov', 'openai', 'https://x.com/v1', 'key', '', 'n'];
    const input = makeAnswerStream(answers);
    const output = new PassThrough();
    const result = await runProviderAddWizard({ configMgr, input, output });

    assert.strictEqual(result.cancelled, false);
    assert.strictEqual(result.providerId, 'newprov');
  });

  test('EOF/stream close mid-wizard → returns cancelled:true', async () => {
    // Only one answer (id) then EOF — subsequent steps get no input
    const answers = ['myproveof'];
    const input = makeAnswerStream(answers); // EOF after id
    const output = new PassThrough();
    const configMgr = makeTmpConfigMgr();

    // Should not throw, should return cancelled
    const result = await runProviderAddWizard({ configMgr, input, output });
    assert.strictEqual(result.cancelled, true);
  });
});
```

- [x] **Step 2.2: Run tests — expect FAIL**

```
node --test tests/step5-provider-wizard.test.js
```

Expected: helper tests PASS, wizard tests FAIL (stub always returns `{ cancelled: true }`).

- [x] **Step 2.3: Implement `runProviderAddWizard` in `src/cli/provider-wizard.js`**

Replace the stub body with the full implementation:

```js
export async function runProviderAddWizard(ctx = {}) {
  const stream = ctx.stream || process.stdout;
  const inputStream = ctx.input || process.stdin;
  const configMgr = ctx.configMgr;
  const prefilledId = ctx.prefilledId || null;

  const rl = readline.createInterface({ input: inputStream, output: stream, terminal: false });

  // Promise-based question helper. Rejects on SIGINT or stream close.
  function ask(prompt) {
    return new Promise((resolve, reject) => {
      const onClose = () => reject(new Error('cancelled'));
      rl.once('close', onClose);
      rl.question(prompt, (answer) => {
        rl.removeListener('close', onClose);
        resolve(answer || '');
      });
    });
  }

  function write(msg) {
    stream.write(msg);
  }

  try {
    // ── Step 1: Provider ID ───────────────────────────────────────────
    let providerId;
    if (prefilledId) {
      providerId = prefilledId.trim();
    } else {
      while (true) {
        const raw = await ask(ansi.cyan('  Provider ID') + ' (e.g. groq, deepseek, ollama): ');
        const id = raw.trim();
        if (!id) {
          write(`${ansi.yellow('  ⚠')} Provider ID cannot be empty.\n`);
          continue;
        }
        // Check for duplicate
        const existingCfg = configMgr ? configMgr.loadConfig() : {};
        const existing = existingCfg.providers || {};
        if (existing[id]) {
          const overwrite = await ask(`${ansi.yellow('  ⚠')} Provider "${ansi.bold(id)}" already exists. Overwrite? [y/N]: `);
          if (overwrite.trim().toLowerCase() !== 'y') {
            write(`  Asking for a new ID...\n`);
            continue;
          }
        }
        providerId = id;
        break;
      }
    }

    // ── Step 2: Adapter ───────────────────────────────────────────────
    let adapter;
    while (true) {
      const raw = await ask(ansi.cyan('  Adapter') + ' [openai/gemini] (default: openai): ');
      const val = raw.trim().toLowerCase();
      if (val === '' || val === 'openai') { adapter = 'openai'; break; }
      if (val === 'gemini') { adapter = 'gemini'; break; }
      write(`${ansi.yellow('  ⚠')} Invalid adapter. Must be "openai" or "gemini".\n`);
    }

    // ── Step 3: Base URL (skip for gemini) ────────────────────────────
    let baseUrl;
    if (adapter !== 'gemini') {
      const raw = await ask(ansi.cyan('  Base URL') + ' (e.g. https://api.groq.com/openai/v1, Enter for OpenAI default): ');
      baseUrl = raw.trim() || '';
    }
    // gemini: baseUrl stays undefined (not stored)

    // ── Step 4: API Key (smart validation) ────────────────────────────
    let apiKey;
    const keyRequired = isApiKeyRequired(adapter, baseUrl || '');
    while (true) {
      const suffix = keyRequired ? '' : ' (optional, Enter to skip)';
      const raw = await ask(ansi.cyan('  API Key') + suffix + ': ');
      const val = raw.trim();
      if (!val && keyRequired) {
        const ctx_label = adapter === 'gemini' ? 'gemini' : 'cloud openai providers';
        write(`${ansi.yellow('  ⚠')} API key is required for ${ctx_label}.\n`);
        continue;
      }
      apiKey = val || undefined; // undefined = not stored
      break;
    }

    // ── Step 5: Default Model (always optional) ───────────────────────
    const rawModel = await ask(ansi.cyan('  Default model') + ' (optional, Enter to skip): ');
    const model = rawModel.trim() || undefined;

    // ── Post-save: switch now? ────────────────────────────────────────
    write(`\n${ansi.green('  ✔')} Provider ${ansi.bold(ansi.yellow(providerId))} ready to save.\n`);
    const rawSwitch = await ask(`  Switch to ${ansi.bold(providerId)} now? [Y/n]: `);
    const switchNow = rawSwitch.trim().toLowerCase() !== 'n';

    rl.close();

    // Build config object — omit undefined fields
    const config = { adapter };
    if (typeof baseUrl === 'string') config.baseUrl = baseUrl;
    if (apiKey) config.apiKey = apiKey;
    if (model) config.model = model;

    return { cancelled: false, providerId, config, switchNow };

  } catch (err) {
    // SIGINT or stream closed mid-wizard
    try { rl.close(); } catch (_) {}
    write(`\n${ansi.yellow('  ⚠')} Provider add cancelled.\n\n`);
    return { cancelled: true };
  }
}
```

- [x] **Step 2.4: Run wizard tests — expect PASS**

```
node --test tests/step5-provider-wizard.test.js
```

Expected: all tests PASS.

- [x] **Step 2.5: Run full test suite — expect no regressions**

```
node --test tests/*.test.js
```

Expected: all previously passing tests still PASS.

- [x] **Step 2.6: Commit**

```bash
git add src/cli/provider-wizard.js tests/step5-provider-wizard.test.js
git commit -m "feat: implement runProviderAddWizard — 5-step interactive provider add wizard"
```

---

## Task 3: Extend `slash-commands.js` — `/model add`, `/model remove`, `/model clear`

**Files:**
- Modify: `src/cli/slash-commands.js`
- Create: `tests/step5-slash-model-crud.test.js`

The `case 'model'` in `executeSlashCommand` currently treats `args[0]` as a model name unconditionally. We need to detect `add`, `remove`, `clear` as sub-commands first, then fall through to existing behavior if none match.

Parse rule for `--provider` flag from the raw `args` array: scan for `--provider` and take the next element as the provider id.

- [x] **Step 3.1: Write failing tests**

Create `tests/step5-slash-model-crud.test.js`:

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { executeSlashCommand } from '../src/cli/slash-commands.js';
import { ConfigManager } from '../src/config/manager.js';
import { stripAnsi } from '../src/utils/ansi.js';

function makeTmpConfigMgr() {
  const tmpDir = path.join(os.tmpdir(), `tai-model-crud-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  return new ConfigManager(tmpDir);
}

function makeContext(configMgr, extraOrchestrator = {}) {
  const output = new PassThrough();
  let written = '';
  output.on('data', c => { written += c.toString(); });
  const orchestrator = {
    provider: 'gemini',
    llmClient: { getModel: () => 'gemini-2.5-flash', setModel: () => {} },
    ...extraOrchestrator
  };
  return { output, get written() { return written; }, context: { configMgr, orchestrator, stream: output } };
}

describe('/model add', () => {
  test('adds a model to active provider catalog', async () => {
    const configMgr = makeTmpConfigMgr();
    const { output, context } = makeContext(configMgr);

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
    const { output, written: _w, context } = makeContext(configMgr);
    let written = '';
    output.on('data', c => { written += c.toString(); });

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
    const { output, context } = makeContext(configMgr, {
      provider: 'gemini',
      llmClient: { getModel: () => 'gemini-2.5-flash', setModel: () => {} }
    });
    let written = '';
    output.on('data', c => { written += c.toString(); });

    // gemini-2.5-flash is the active model
    const res = await executeSlashCommand('/model remove gemini-2.5-flash', context);

    assert.strictEqual(res.handled, true);
    const plain = stripAnsi(written);
    assert.ok(plain.includes('active') || plain.includes('Switch'), 'should mention active model constraint');
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

    assert.ok(res.action === 'model_info' || res.action === 'model_changed', 'existing model_info still works');
  });

  test('/model gemini-2.5-pro still switches model (not treated as subcommand)', async () => {
    const configMgr = makeTmpConfigMgr();
    const mockOrchestrator = {
      provider: 'gemini',
      llmClient: { model: 'gemini-2.5-flash', getModel() { return this.model; }, setModel(m) { this.model = m; } },
      session: { model: 'gemini-2.5-flash' }
    };
    const output = new PassThrough();
    const res = await executeSlashCommand('/model gemini-2.5-pro', {
      configMgr,
      orchestrator: mockOrchestrator,
      stream: output
    });

    assert.strictEqual(res.action, 'model_changed');
    assert.strictEqual(res.message, 'gemini-2.5-pro');
  });
});
```

- [x] **Step 3.2: Run tests — expect FAIL**

```
node --test tests/step5-slash-model-crud.test.js
```

Expected: most tests FAIL because `args[0] = 'add'` is currently treated as a model name by the `/model` case.

- [x] **Step 3.3: Add imports to `slash-commands.js`**

At the top of `src/cli/slash-commands.js`, add after the existing imports:

```js
import { addModelsCli, removeModelCli, clearModelsCli } from './model-commands.js';
```

- [x] **Step 3.4: Add sub-command parser helper inside `slash-commands.js` (before `executeSlashCommand`)**

```js
/**
 * Parse --provider flag from an args array.
 * e.g. ['add', 'gpt-4', '--provider', 'openai'] → 'openai'
 * @param {string[]} args
 * @returns {string|null}
 */
function parseProviderFlag(args) {
  const idx = args.indexOf('--provider');
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return null;
}
```

- [x] **Step 3.5: Modify `case 'model'` in `executeSlashCommand`**

At the very start of the `case 'model':` block, BEFORE `const newModel = args[0]`, insert sub-command routing. Find this existing line:

```js
    case 'model': {
      const newModel = args[0];
```

Replace with:

```js
    case 'model': {
      const modelSubCmd = args[0];
      const providerOverride = parseProviderFlag(args);

      // Sub-command routing: add / remove / clear
      if (modelSubCmd === 'add') {
        // Collect everything between 'add' and any '--provider' flag as model names
        const modelArgs = args.slice(1).filter(a => a !== '--provider' && a !== providerOverride);
        const models = modelArgs.join(',') || '';
        const result = addModelsCli({ configMgr, models, providerOverride });
        if (result.output) stream.write(result.output);
        return { handled: true, action: 'model_add', error: result.exitCode !== 0 };
      }

      if (modelSubCmd === 'remove') {
        const modelArgs = args.slice(1).filter(a => a !== '--provider' && a !== providerOverride);
        const models = modelArgs.join(',') || '';
        const result = removeModelCli({ configMgr, models, providerOverride });
        if (result.output) stream.write(result.output);
        return { handled: true, action: 'model_remove', error: result.exitCode !== 0 };
      }

      if (modelSubCmd === 'clear') {
        const result = clearModelsCli({ configMgr, providerOverride });
        if (result.output) stream.write(result.output);
        return { handled: true, action: 'model_clear', error: result.exitCode !== 0 };
      }

      // Not a sub-command — fall through to existing model switch/info behavior
      const newModel = modelSubCmd;
```

Important: close the fallthrough correctly. The existing code after `const newModel = args[0]` remains unchanged. Just make sure the entire `case 'model'` block still closes with `}`.

- [x] **Step 3.6: Run model CRUD tests — expect PASS**

```
node --test tests/step5-slash-model-crud.test.js
```

Expected: all tests PASS.

- [x] **Step 3.7: Run full test suite — no regressions**

```
node --test tests/*.test.js
```

Expected: all tests PASS.

- [x] **Step 3.8: Commit**

```bash
git add src/cli/slash-commands.js tests/step5-slash-model-crud.test.js
git commit -m "feat: add /model add, /model remove, /model clear slash commands"
```

---

## Task 4: Extend `slash-commands.js` — `/provider add`, `/provider remove`, `/provider show`

**Files:**
- Modify: `src/cli/slash-commands.js`

The `case 'provider'` block already handles `list`, an explicit provider id (switch), and shows active provider on no args. We extend it with `add`, `remove`, `show`.

- [x] **Step 4.1: Write failing tests**

Add to `tests/step5-piping.test.js` (in the `Step 5: REPL Slash Commands Handler` describe block, after existing cases):

```js
  // ─── /provider add (wizard integration) ─────────────────────────────────
  test('/provider add cancel returns handled:true, nothing saved', async () => {
    const { PassThrough } = await import('node:stream');
    const os = await import('node:os');
    const path = await import('node:path');
    const fs = await import('node:fs');
    const { ConfigManager: CM } = await import('../src/config/manager.js');
    const tmpDir = path.join(os.tmpdir(), `tai-pa-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const configMgr = new CM(tmpDir);

    // Input stream that immediately closes (simulates Ctrl+C / EOF)
    const input = new PassThrough();
    input.isTTY = false;
    setImmediate(() => input.push(null)); // EOF right away

    const output = new PassThrough();
    const res = await executeSlashCommand('/provider add', {
      configMgr,
      stream: output,
      input
    });

    assert.strictEqual(res.handled, true);
    assert.strictEqual(res.action, 'provider_add_cancelled');
    const cfg = configMgr.loadConfig();
    // No new providers should be in config
    assert.deepStrictEqual(Object.keys(cfg.providers || {}), []);
  });

  // ─── /provider remove ────────────────────────────────────────────────────
  test('/provider remove non-active custom provider — removes it', async () => {
    const { PassThrough } = await import('node:stream');
    const os = await import('node:os');
    const path = await import('node:path');
    const fs = await import('node:fs');
    const { ConfigManager: CM } = await import('../src/config/manager.js');
    const tmpDir = path.join(os.tmpdir(), `tai-pr-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const configMgr = new CM(tmpDir);
    const cfg = configMgr.loadConfig();
    cfg.providers.myprov = { adapter: 'openai' };
    cfg.activeProvider = 'gemini'; // different from myprov
    configMgr.saveConfig(cfg);

    const output = new PassThrough();
    let written = '';
    output.on('data', c => { written += c.toString(); });

    const res = await executeSlashCommand('/provider remove myprov', {
      configMgr,
      stream: output
    });

    assert.strictEqual(res.handled, true);
    assert.strictEqual(res.action, 'provider_removed');
    const updated = configMgr.loadConfig();
    assert.ok(!updated.providers?.myprov, 'provider should be gone');
  });

  test('/provider remove active provider prompts confirmation, aborts on N', async () => {
    const { PassThrough } = await import('node:stream');
    const os = await import('node:os');
    const path = await import('node:path');
    const fs = await import('node:fs');
    const { ConfigManager: CM } = await import('../src/config/manager.js');
    const tmpDir = path.join(os.tmpdir(), `tai-pra-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const configMgr = new CM(tmpDir);
    const cfg = configMgr.loadConfig();
    cfg.providers.myprov = { adapter: 'openai' };
    cfg.activeProvider = 'myprov';
    configMgr.saveConfig(cfg);

    // Input stream answers 'n' to confirmation
    const input = new PassThrough();
    input.isTTY = false;
    setImmediate(() => { input.push('n\n'); input.push(null); });

    const output = new PassThrough();
    const res = await executeSlashCommand('/provider remove myprov', {
      configMgr,
      stream: output,
      input
    });

    assert.strictEqual(res.handled, true);
    // Provider should still exist
    const updated = configMgr.loadConfig();
    assert.ok(updated.providers?.myprov, 'provider should NOT be removed on N');
  });

  test('/provider remove missing id shows error', async () => {
    const { PassThrough } = await import('node:stream');
    const output = new PassThrough();
    let written = '';
    output.on('data', c => { written += c.toString(); });

    const res = await executeSlashCommand('/provider remove', {
      stream: output
    });
    assert.strictEqual(res.handled, true);
    assert.strictEqual(res.error, true);
  });

  test('/provider remove builtin provider shows error', async () => {
    const { PassThrough } = await import('node:stream');
    const os = await import('node:os');
    const path = await import('node:path');
    const fs = await import('node:fs');
    const { ConfigManager: CM } = await import('../src/config/manager.js');
    const tmpDir = path.join(os.tmpdir(), `tai-prb-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const configMgr = new CM(tmpDir);

    const output = new PassThrough();
    let written = '';
    output.on('data', c => { written += c.toString(); });

    const res = await executeSlashCommand('/provider remove gemini', {
      configMgr,
      stream: output
    });
    assert.strictEqual(res.handled, true);
    assert.strictEqual(res.error, true);
    assert.ok(stripAnsi(written).toLowerCase().includes('builtin') || stripAnsi(written).toLowerCase().includes('cannot'), 'should explain why removal failed');
  });

  // ─── /provider show ──────────────────────────────────────────────────────
  test('/provider show renders config box for given provider', async () => {
    const { PassThrough } = await import('node:stream');
    const os = await import('node:os');
    const path = await import('node:path');
    const fs = await import('node:fs');
    const { ConfigManager: CM } = await import('../src/config/manager.js');
    const tmpDir = path.join(os.tmpdir(), `tai-ps-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const configMgr = new CM(tmpDir);

    const output = new PassThrough();
    let written = '';
    output.on('data', c => { written += c.toString(); });

    const res = await executeSlashCommand('/provider show gemini', {
      configMgr,
      stream: output
    });
    assert.strictEqual(res.handled, true);
    assert.strictEqual(res.action, 'provider_show');
    const plain = stripAnsi(written);
    assert.ok(plain.includes('gemini'), 'output should contain provider id');
  });

  test('/provider show (no arg) shows active provider config', async () => {
    const { PassThrough } = await import('node:stream');
    const os = await import('node:os');
    const path = await import('node:path');
    const fs = await import('node:fs');
    const { ConfigManager: CM } = await import('../src/config/manager.js');
    const tmpDir = path.join(os.tmpdir(), `tai-psa-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const configMgr = new CM(tmpDir);
    const mockOrchestrator = { provider: 'gemini' };

    const output = new PassThrough();
    let written = '';
    output.on('data', c => { written += c.toString(); });

    const res = await executeSlashCommand('/provider show', {
      configMgr,
      orchestrator: mockOrchestrator,
      stream: output
    });
    assert.strictEqual(res.handled, true);
    assert.strictEqual(res.action, 'provider_show');
    assert.ok(stripAnsi(written).includes('gemini'));
  });
```

- [x] **Step 4.2: Run failing tests**

```
node --test tests/step5-piping.test.js 2>&1 | tail -30
```

Expected: new `/provider add/remove/show` tests FAIL, existing tests still PASS.

- [x] **Step 4.3: Add import for `runProviderAddWizard` to `slash-commands.js`**

At the top of `src/cli/slash-commands.js`, add:

```js
import { runProviderAddWizard } from './provider-wizard.js';
```

- [x] **Step 4.4: Extend `case 'provider'` in `executeSlashCommand`**

In `src/cli/slash-commands.js`, find the `case 'provider':` block. After the existing `if (action === 'list')` and before the `const providerId = action` line, insert these three new action handlers:

```js
      // ── /provider add ──────────────────────────────────────────────
      if (action === 'add') {
        const prefilledId = args[1] || null; // /provider add <id> pre-fills step 1
        const wizardResult = await runProviderAddWizard({
          configMgr,
          stream,
          input: inputStream,
          prefilledId
        });

        if (wizardResult.cancelled) {
          return { handled: true, action: 'provider_add_cancelled' };
        }

        // Persist to config
        const cfg = configMgr ? configMgr.loadConfig() : {};
        if (!cfg.providers) cfg.providers = {};
        cfg.providers[wizardResult.providerId] = wizardResult.config;
        if (configMgr) configMgr.saveConfig(cfg);

        // Optionally switch active provider
        if (wizardResult.switchNow) {
          if (configMgr) configMgr.set('activeProvider', wizardResult.providerId);
          if (orchestrator && typeof orchestrator.setProvider === 'function') {
            try {
              orchestrator.setProvider(wizardResult.providerId, {
                apiKey: wizardResult.config.apiKey,
                model: wizardResult.config.model,
                baseUrl: wizardResult.config.baseUrl
              });
            } catch (_) {
              // setProvider may fail if adapter not loaded — config already saved
              stream.write(`${ansi.yellow('ℹ')} Could not switch live session. Restart REPL to apply.\n\n`);
            }
          } else if (!orchestrator) {
            stream.write(`${ansi.yellow('ℹ')} No active session. Restart REPL to apply provider switch.\n\n`);
          }
          stream.write(`\n${ansi.green('✔')} Provider "${ansi.bold(ansi.yellow(wizardResult.providerId))}" saved and activated.\n\n`);
        } else {
          stream.write(`\n${ansi.green('✔')} Provider "${ansi.bold(ansi.yellow(wizardResult.providerId))}" saved.\n  To use it: ${ansi.cyan('/provider ' + wizardResult.providerId)}\n\n`);
        }

        return { handled: true, action: 'provider_added', providerId: wizardResult.providerId };
      }

      // ── /provider remove <id> ──────────────────────────────────────
      if (action === 'remove') {
        const removeId = args[1];
        if (!removeId) {
          stream.write(`\n${ansi.yellow('⚠')} Usage: /provider remove <id>\n\n`);
          return { handled: true, action: 'provider_remove_error', error: true };
        }

        // Guard: refuse to remove builtin providers
        const { BUILTIN_PROVIDERS } = await import('../config/constants.js');
        if (BUILTIN_PROVIDERS[removeId]) {
          stream.write(`\n${ansi.red('✖')} Cannot remove builtin provider "${ansi.bold(removeId)}". Only custom providers can be removed.\n\n`);
          return { handled: true, action: 'provider_remove_error', error: true };
        }

        // Confirm if removing active provider
        const activeP = (orchestrator && orchestrator.provider) || configMgr?.get('activeProvider') || 'gemini';
        if (removeId === activeP) {
          const confirm = await new Promise((resolve) => {
            inputStream.once('data', (chunk) => resolve(chunk.toString().trim()));
            stream.write(`\n${ansi.yellow('⚠')} "${ansi.bold(removeId)}" is the active provider. Remove anyway? [y/N]: `);
          });
          if (confirm.toLowerCase() !== 'y') {
            stream.write(`${ansi.dim('Removal cancelled.')}\n\n`);
            return { handled: true, action: 'provider_remove_cancelled' };
          }
        }

        try {
          if (configMgr) configMgr.removeProvider(removeId);
          stream.write(`\n${ansi.green('✔')} Provider "${ansi.bold(ansi.yellow(removeId))}" removed.\n\n`);
          return { handled: true, action: 'provider_removed' };
        } catch (err) {
          stream.write(`\n${ansi.red('✖')} ${err.message}\n\n`);
          return { handled: true, action: 'provider_remove_error', error: true };
        }
      }

      // ── /provider show [id] ────────────────────────────────────────
      if (action === 'show') {
        const showId = args[1] || (orchestrator && orchestrator.provider) || configMgr?.get('activeProvider') || 'gemini';
        try {
          const provCfg = configMgr ? configMgr.getProviderConfig(showId) : {};
          const { renderBox } = await import('../ui/box.js');
          // Mask API key for display
          const display = { ...provCfg };
          if (display.apiKey && typeof display.apiKey === 'string' && display.apiKey.length > 8) {
            display.apiKey = `${display.apiKey.slice(0, 4)}...${display.apiKey.slice(-4)}`;
          }
          const lines = Object.entries(display)
            .filter(([, v]) => v !== undefined && v !== null && (!Array.isArray(v) || v.length > 0))
            .map(([k, v]) => {
              const val = Array.isArray(v) ? v.join(', ') : String(v);
              return `  ${ansi.cyan(k.padEnd(14))} ${ansi.dim('│')} ${ansi.white(val)}`;
            });
          const box = renderBox(lines.join('\n'), {
            title: `Provider: ${showId}`,
            borderColor: 'cyan',
            borderStyle: 'round',
            minWidth: 48
          });
          stream.write(`\n${box}\n\n`);
          return { handled: true, action: 'provider_show' };
        } catch (err) {
          stream.write(`\n${ansi.yellow('⚠')} ${err.message}\n\n`);
          return { handled: true, action: 'provider_show_error', error: true };
        }
      }
```

- [x] **Step 4.5: Run new tests — expect PASS**

```
node --test tests/step5-piping.test.js
```

Expected: all tests (existing + new) PASS.

- [x] **Step 4.6: Run full test suite — no regressions**

```
node --test tests/*.test.js
```

Expected: all tests PASS.

- [x] **Step 4.7: Commit**

```bash
git add src/cli/slash-commands.js tests/step5-piping.test.js
git commit -m "feat: add /provider add wizard, /provider remove, /provider show slash commands"
```

---

## Task 5: Update `SLASH_COMMANDS_HELP` entries

**Files:**
- Modify: `src/cli/slash-commands.js`

`SLASH_COMMANDS_HELP` is the array at the top of `slash-commands.js` that `/help` renders. Six new entries need to be added.

- [x] **Step 5.1: Update `SLASH_COMMANDS_HELP` in `src/cli/slash-commands.js`**

Find the existing `SLASH_COMMANDS_HELP` array:

```js
export const SLASH_COMMANDS_HELP = [
  { cmd: '/help', desc: 'Show this slash commands help menu' },
  { cmd: '/provider [id]', desc: 'Show active provider or switch provider + persist' },
  { cmd: '/provider list', desc: 'List configured providers' },
  { cmd: '/model [name]', desc: 'Show available models (interactive TTY menu) or switch to a new model' },
  ...
];
```

Replace with:

```js
export const SLASH_COMMANDS_HELP = [
  { cmd: '/help',                    desc: 'Show this slash commands help menu' },
  { cmd: '/provider [id]',           desc: 'Show active provider or switch provider + persist' },
  { cmd: '/provider list',           desc: 'List configured providers' },
  { cmd: '/provider add [id]',       desc: 'Add a new provider via interactive wizard' },
  { cmd: '/provider remove <id>',    desc: 'Remove a configured provider' },
  { cmd: '/provider show [id]',      desc: 'Show provider config details' },
  { cmd: '/model [name]',            desc: 'Show available models (interactive TTY menu) or switch to a new model' },
  { cmd: '/model add <name[,...]>',  desc: 'Add model(s) to provider catalog' },
  { cmd: '/model remove <name>',     desc: 'Remove a model from provider catalog' },
  { cmd: '/model clear',             desc: 'Reset provider catalog to builtin defaults' },
  { cmd: '/session',                 desc: 'Display current session ID, token usage & stats' },
  { cmd: '/clear',                   desc: 'Clear the terminal screen' },
  { cmd: '/config',                  desc: 'Display active CLI configuration settings' },
  { cmd: '/exit, /quit',             desc: 'Exit interactive REPL session' }
];
```

- [x] **Step 5.2: Verify /help output includes new entries**

```
node --test tests/step5-piping.test.js 2>&1 | grep -i "help"
```

Also write a quick inline check — find the existing `/help` test in `tests/step5-piping.test.js` and add two assertions:

```js
assert.ok(plain.includes('/provider add'), 'help should list /provider add');
assert.ok(plain.includes('/model add'), 'help should list /model add');
```

- [x] **Step 5.3: Run full test suite**

```
node --test tests/*.test.js
```

Expected: all tests PASS.

- [x] **Step 5.4: Commit**

```bash
git add src/cli/slash-commands.js tests/step5-piping.test.js
git commit -m "feat: update /help to list new provider and model CRUD slash commands"
```

---

## Task 6: Export `runProviderAddWizard` from `src/cli/index.js`

**Files:**
- Modify: `src/cli/index.js`

The `provider-wizard.js` file needs to be re-exported from `cli/index.js` so it's accessible via `src/index.js` (the library entrypoint used in tests via `'../src/index.js'`).

- [x] **Step 6.1: Add export to `src/cli/index.js`**

Open `src/cli/index.js`. It currently ends with:

```js
export * from './model-commands.js';
```

Add one line:

```js
export * from './model-commands.js';
export * from './provider-wizard.js';
```

- [x] **Step 6.2: Verify `isLocalUrl` and `isApiKeyRequired` are accessible from `src/index.js`**

```js
// Quick smoke test — add temporarily to any test, then remove
import { isLocalUrl } from '../src/index.js';
console.log(isLocalUrl('http://localhost:11434/v1')); // true
```

Or just run the full test suite which imports from `src/index.js`:

```
node --test tests/*.test.js
```

Expected: all tests PASS.

- [x] **Step 6.3: Commit**

```bash
git add src/cli/index.js
git commit -m "chore: export provider-wizard from cli/index.js"
```

---

## Task 7: Final verification

- [x] **Step 7.1: Run complete test suite**

```
node --test tests/*.test.js
```

Expected output includes:
- All existing tests PASS (zero regressions)
- New test files `step5-provider-wizard.test.js` and `step5-slash-model-crud.test.js` fully PASS
- New cases in `step5-piping.test.js` PASS

- [x] **Step 7.2: Manual smoke test (optional but recommended on Termux)**

```bash
termuxai
# Inside REPL:
/help               # should show /provider add, /model add in help
/provider show      # should show gemini config box
/model add test-model
/model              # test-model should appear in catalog
/model remove test-model
/model clear        # reset to defaults
/provider add       # launch wizard, fill in groq, cancel with Ctrl+C → nothing saved
```

- [x] **Step 7.3: Final commit (if any cleanup needed)**

```bash
git add .
git commit -m "chore: final cleanup for repl-provider-model-crud feature"
```

---

## Self-Review Checklist

**Spec coverage check:**

| Spec requirement | Covered by task |
|---|---|
| `/provider add` wizard interaktif | Task 2 (wizard), Task 4 (slash routing) |
| `/provider add <id>` pre-filled | Task 4 step 4.4 (`prefilledId`) |
| `/provider remove <id>` | Task 4 step 4.4 |
| `/provider show [id]` | Task 4 step 4.4 |
| `/model add <name>` | Task 3 |
| `/model add --provider <id>` | Task 3 (`parseProviderFlag`) |
| `/model remove <name>` | Task 3 |
| `/model clear` | Task 3 |
| Smart validation — gemini wajib API key | Task 2 (`isApiKeyRequired`) |
| Smart validation — localhost opsional | Task 2 (`isLocalUrl`) |
| Smart validation — cloud wajib API key | Task 2 |
| Step 3 skip for gemini | Task 2 step 2.3 |
| Ctrl+C cancellation → tidak disimpan | Task 2 (try/catch on rl), Task 4 (cancelled check) |
| Provider ID duplicate → konfirmasi overwrite | Task 2 step 2.3 |
| Post-save switch prompt | Task 2 step 2.3 |
| `/help` shows new commands | Task 5 |
| Backward compat `/model <name>` | Task 3 step 3.5 (fallthrough) |
| Backward compat `/model` no args | Task 3 tests |
| Refuse to remove builtin provider | Task 4 step 4.4 |
| Confirm when removing active provider | Task 4 step 4.4 |
| Orchestrator.setProvider on switchNow | Task 4 step 4.4 |
| `provider-wizard.js` exported | Task 6 |

All spec requirements covered. No gaps found.
