# Rename CLI from `t-ai` to `termuxai` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace the `t-ai` (and `tai`) CLI command name with `termuxai` everywhere it appears as a user-facing command. Keep env-var and config-dir backward compatibility so existing users with `T_AI_API_KEY` / `~/.t-ai/` still work, but new code/CLI only references `termuxai` / `TERMUXAI_*` / `~/.termuxai/`.

**Architecture:** Central rename. `APP_NAME` and `DEFAULT_CONFIG_DIR_NAME` in `src/config/constants.js` are the single source of truth for the command name and config-dir name. `manager.js` adds a primary→legacy env-var fallback chain. `repl.js` switches from hardcoded `'t-ai'` to the `APP_NAME` constant. Tests/docs/install-script updated in lockstep.

**Tech Stack:** Node.js ≥18, ESM, vanilla `node:test` runner. No new deps.

---

## Scope Decisions (user-confirmed)

- Primary command: `termuxai` (only). Drop `t-ai` and `tai` aliases entirely.
- Env-var backward compat: `T_AI_API_KEY` and `T_AI_CONFIG_DIR` still read as fallback when `TERMUXAI_*` is unset.
- Config-dir backward compat: `~/.t-ai/` still detected when `~/.termuxai/` is absent.
- Docs: README, PRD (`AI Termux.md`), all step plans (`plans/STEP_*.md`, `MASTER_PLAN.md`) all updated.
- Out of scope: GitHub repo rename, npm package name rename, `bin/tai.js` filename rename (internal path).

## File Inventory

**Modified (source):**
- `src/config/constants.js` — `APP_NAME`, `DEFAULT_CONFIG_DIR_NAME`
- `src/config/manager.js` — env-var fallback chain (API key + config dir)
- `src/utils/termux.js` — `getConfigRoot()` uses `DEFAULT_CONFIG_DIR_NAME` constant
- `src/cli/repl.js` — `REPL_PROMPT` uses `APP_NAME`
- `src/agent/system-prompt.js` — system prompt persona string
- `src/llm/gemini.js` — API-key error message
- `src/security/rules.js` — `DEFAULT_IGNORE_PATTERNS` + header comment
- Header comments (cosmetic, all in one task): `bin/tai.js`, `src/index.js`, `src/cli/help.js`, `src/cli/piping.js`, `src/agent/session.js`, `src/llm/index.js`, `src/utils/logger.js`

**Modified (install/scripts):**
- `package.json` — `bin` field
- `install.sh` — symlinks, banner, all user-facing strings
- `scripts/benchmark.js` — env var name + comment + final message
- `scripts/test-e2e.js` — header comment

**Modified (tests):**
- `tests/step1-config.test.js` — new TERMUXAI_API_KEY priority test, keep legacy test
- `tests/step1-args.test.js` — fixture dir names
- `tests/step3-stream.test.js` — `.t-ai/config.json` fixture
- `tests/step4-orchestrator.test.js` — `'asisten t-ai'` fixture + temp dir
- `tests/step4-session.test.js` — system-prompt assertion + temp dir
- `tests/step2-security.test.js` — temp dirs
- `tests/step2-tools.test.js` — temp dir
- `tests/e2e/e2e-piping.test.js` — temp dir
- `tests/e2e/e2e-self-healing.test.js` — temp dir
- `tests/e2e/e2e-session-resume.test.js` — temp dir

**Modified (docs):**
- `README.md` — every `t-ai` in user-facing text + env-var + config-dir sections
- `AI Termux.md` — PRD references
- `plans/STEP_1_FOUNDATION_CONFIG.md` through `STEP_6_INTEGRATION_TERMUX_PACKAGING.md` + `MASTER_PLAN.md` — replace `t-ai` command references

---

## Task 1: Update `APP_NAME` and `DEFAULT_CONFIG_DIR_NAME` constants

**Files:**
- Modify: `src/config/constants.js:6,12`

- [x] **Step 1: Edit constants.js**

Replace in `C:\xampp\htdocs\faydev\ai-termux\src\config\constants.js`:

```js
/**
 * Application Constants & Default Configuration Values
 * Termux AI CLI (`termuxai`)
 */

export const APP_NAME = 'termuxai';
export const APP_FULL_NAME = 'termux-ai-cli';
export const APP_VERSION = '1.0.0';
export const APP_DESCRIPTION = 'Autonomous AI Agent CLI optimized for Termux Android environment';

// Configuration Paths
export const DEFAULT_CONFIG_DIR_NAME = '.termuxai';
export const DEFAULT_CONFIG_FILE_NAME = 'config.json';
export const DEFAULT_SESSIONS_DIR_NAME = 'sessions';

// Fallback Termux home directory if os.homedir() returns empty or unusual root
export const TERMUX_HOME_FALLBACK = '/data/data/com.termux/files/home';

// Default Model & Parameters
export const DEFAULT_MODEL = 'gemini-2.5-flash';
export const SUPPORTED_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-2.0-flash'
];

// Execution Defaults
export const DEFAULT_TIMEOUT_MS = 30000; // 30 seconds
export const DEFAULT_MAX_CONTEXT_TOKENS = 1000000;
export const DEFAULT_TEMPERATURE = 0.7;

// Default Config Object
export const DEFAULT_CONFIG = {
  model: DEFAULT_MODEL,
  apiKey: '',
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxContextTokens: DEFAULT_MAX_CONTEXT_TOKENS,
  autoConfirm: false,
  verbose: false
};
```

Changes:
- Line 3 comment: `(t-ai)` → `(termuxai)`
- Line 6: `'t-ai'` → `'termuxai'`
- Line 12: `'.t-ai'` → `'.termuxai'`

- [x] **Step 2: Run existing tests to confirm constants are still consumed correctly**

Run: `node --test tests/step1-config.test.js`
Expected: PASS (the test does not assert specific constant values for `APP_NAME`).

- [x] **Step 3: Commit**

```bash
git add src/config/constants.js
git commit -m "refactor(constants): rename APP_NAME to 'termuxai' and config dir to '.termuxai'"
```

---

## Task 2: Add env-var + config-dir backward compat to `ConfigManager`

**Files:**
- Modify: `src/config/manager.js:24-37,211-227`

- [x] **Step 1: Add failing test for `TERMUXAI_API_KEY` priority in `tests/step1-config.test.js`**

In the existing `test('should resolve API key according to precedence order', ...)` block (around line 78-105), add a new test before the closing `});` of `describe`:

```js
test('should prefer TERMUXAI_API_KEY over legacy T_AI_API_KEY', () => {
  const originalEnv = { ...process.env };
  try {
    delete process.env.GEMINI_API_KEY;
    process.env.TERMUXAI_API_KEY = 'env-termuxai-key';
    process.env.T_AI_API_KEY = 'env-tai-key';
    assert.equal(manager.getApiKey(), 'env-termuxai-key');

    // Drop new var, confirm legacy still works
    delete process.env.TERMUXAI_API_KEY;
    assert.equal(manager.getApiKey(), 'env-tai-key');
  } finally {
    delete process.env.TERMUXAI_API_KEY;
    delete process.env.T_AI_API_KEY;
    process.env = originalEnv;
  }
});

test('should prefer TERMUXAI_CONFIG_DIR over legacy T_AI_CONFIG_DIR', () => {
  const originalEnv = { ...process.env };
  try {
    const newDir = path.join(os.tmpdir(), `termuxai-cfg-${Date.now()}`);
    const legacyDir = path.join(os.tmpdir(), `legacy-cfg-${Date.now()}`);
    fs.mkdirSync(newDir, { recursive: true });
    fs.mkdirSync(legacyDir, { recursive: true });

    process.env.TERMUXAI_CONFIG_DIR = newDir;
    process.env.T_AI_CONFIG_DIR = legacyDir;
    const m = new ConfigManager();
    assert.equal(m.getConfigDir(), path.resolve(newDir));

    // Drop new var, confirm legacy still works
    delete process.env.TERMUXAI_CONFIG_DIR;
    assert.equal(m.getConfigDir(), path.resolve(legacyDir));
  } finally {
    delete process.env.TERMUXAI_CONFIG_DIR;
    delete process.env.T_AI_CONFIG_DIR;
    process.env = originalEnv;
  }
});

test('should fall back to legacy ~/.t-ai directory when ~/.termuxai does not exist', () => {
  const originalEnv = { ...process.env };
  const originalHome = process.env.HOME;
  const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'termuxai-home-'));
  const legacyDir = path.join(sandboxHome, '.t-ai');
  fs.mkdirSync(legacyDir, { recursive: true });
  // Intentionally do NOT create .termuxai — this is the migration scenario.

  try {
    process.env.HOME = sandboxHome;
    delete process.env.TERMUXAI_CONFIG_DIR;
    delete process.env.T_AI_CONFIG_DIR;

    const m = new ConfigManager();
    assert.equal(m.getConfigDir(), path.resolve(legacyDir));
  } finally {
    process.env.HOME = originalHome;
    delete process.env.TERMUXAI_CONFIG_DIR;
    delete process.env.T_AI_CONFIG_DIR;
    try { fs.rmSync(sandboxHome, { recursive: true, force: true }); } catch {}
    process.env = originalEnv;
  }
});
```

Also fix the existing line 14 fixture name (cosmetic but part of this task):
- Line 14: `` `t-ai-test-${Date.now()}-${Math.random().toString(36).slice(2)}` `` → `` `termuxai-test-${Date.now()}-${Math.random().toString(36).slice(2)}` ``

- [x] **Step 2: Run tests to verify they fail**

Run: `node --test tests/step1-config.test.js`
Expected: 2 new tests FAIL with "expected 'env-tai-key' to equal 'env-termuxai-key'" and a config-dir assertion error.

- [x] **Step 3: Update `src/config/manager.js` env-var resolution**

In `src/config/manager.js`:

(a) Update `getConfigDir()` method (lines 27-37):

```js
getConfigDir() {
  if (this.customConfigDir) {
    return path.resolve(this.customConfigDir);
  }
  if (process.env.TERMUXAI_CONFIG_DIR) {
    return path.resolve(process.env.TERMUXAI_CONFIG_DIR);
  }
  // Legacy env-var fallback for users upgrading from t-ai
  if (process.env.T_AI_CONFIG_DIR) {
    return path.resolve(process.env.T_AI_CONFIG_DIR);
  }

  const homeDir = os.homedir() || process.env.HOME || TERMUX_HOME_FALLBACK;
  const primaryDir = path.join(homeDir, DEFAULT_CONFIG_DIR_NAME);
  // Legacy directory fallback: if ~/.termuxai doesn't exist but ~/.t-ai does,
  // use the legacy dir so existing users' configs and sessions still load.
  const legacyDir = path.join(homeDir, '.t-ai');
  if (!fs.existsSync(primaryDir) && fs.existsSync(legacyDir)) {
    return legacyDir;
  }
  return primaryDir;
}
```

(b) Update `getApiKey()` method (lines 216-235):

```js
getApiKey(overrideKey = null) {
  if (overrideKey && typeof overrideKey === 'string' && overrideKey.trim().length > 0) {
    return overrideKey.trim();
  }

  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0) {
    return process.env.GEMINI_API_KEY.trim();
  }

  if (process.env.TERMUXAI_API_KEY && process.env.TERMUXAI_API_KEY.trim().length > 0) {
    return process.env.TERMUXAI_API_KEY.trim();
  }

  // Legacy fallback for users upgrading from t-ai
  if (process.env.T_AI_API_KEY && process.env.T_AI_API_KEY.trim().length > 0) {
    return process.env.T_AI_API_KEY.trim();
  }

  const config = this.loadConfig();
  if (config.apiKey && typeof config.apiKey === 'string' && config.apiKey.trim().length > 0) {
    return config.apiKey.trim();
  }

  return null;
}
```

(c) Update header comment (line 24):

```js
   * Priority: customConfigDir > process.env.TERMUXAI_CONFIG_DIR > process.env.T_AI_CONFIG_DIR > os.homedir()/.termuxai > fallback
```

- [x] **Step 4: Run tests to verify they pass**

Run: `node --test tests/step1-config.test.js`
Expected: all PASS, including new `TERMUXAI_API_KEY` and `TERMUXAI_CONFIG_DIR` priority tests.

- [x] **Step 5: Commit**

```bash
git add src/config/manager.js tests/step1-config.test.js
git commit -m "feat(config): prefer TERMUXAI_* env vars with T_AI_* legacy fallback"
```

---

## Task 3: Update `src/utils/termux.js` default config-root helper

**Files:**
- Modify: `src/utils/termux.js:66-75`

- [x] **Step 1: Add failing test in a new file `tests/step1-utils-termux.test.js`**

Create `C:\xampp\htdocs\faydev\ai-termux\tests\step1-utils-termux.test.js`:

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getConfigRoot } from '../src/utils/termux.js';
import { DEFAULT_CONFIG_DIR_NAME } from '../src/config/constants.js';

describe('Utils: termux.getConfigRoot', () => {
  test('should join home directory with default config dir name constant', () => {
    const root = getConfigRoot();
    assert.ok(root.endsWith(DEFAULT_CONFIG_DIR_NAME));
    assert.equal(DEFAULT_CONFIG_DIR_NAME, '.termuxai');
  });

  test('should not contain the legacy .t-ai directory name', () => {
    const root = getConfigRoot();
    assert.ok(!root.endsWith('.t-ai'));
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/step1-utils-termux.test.js`
Expected: FAIL with "expected '.t-ai' to equal '.termuxai'" (constant check) or "expected '...t-ai' to not end with '.t-ai'".

- [x] **Step 3: Update `src/utils/termux.js`**

Edit `getConfigRoot()` (lines 65-75) and its comment:

```js
/**
 * Resolve the termuxai configuration root directory.
 * On Termux: `~/.termuxai` under Termux home.
 * On other platforms: `~/.termuxai` under os.homedir().
 *
 * @returns {string}
 */
export function getConfigRoot() {
  const home = getTermuxHome();
  return path.join(home, '.termuxai');
}
```

(`.termuxai` is duplicated here rather than importing `DEFAULT_CONFIG_DIR_NAME` to keep this util dependency-light. If you prefer the import, add `import { DEFAULT_CONFIG_DIR_NAME } from '../config/constants.js';` and use the constant.)

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/step1-utils-termux.test.js`
Expected: PASS.

- [x] **Step 5: Run all step-1 tests to confirm no regression**

Run: `node --test tests/step1-args.test.js tests/step1-config.test.js tests/step1-utils-termux.test.js`
Expected: all PASS.

- [x] **Step 6: Commit**

```bash
git add src/utils/termux.js tests/step1-utils-termux.test.js
git commit -m "refactor(utils): update termux config-root to use .termuxai"
```

---

## Task 4: Update `REPL_PROMPT` in `src/cli/repl.js` to use `APP_NAME` constant

**Files:**
- Modify: `src/cli/repl.js:16`

- [x] **Step 1: Add failing test in `tests/step5-markdown.test.js`**

Append a new test to the existing `describe(...)` in `tests/step5-markdown.test.js`:

```js
import { REPL_PROMPT } from '../src/cli/repl.js';
import { APP_NAME } from '../src/config/constants.js';

test('REPL_PROMPT should include APP_NAME constant', () => {
  assert.ok(REPL_PROMPT.includes(APP_NAME));
  assert.equal(APP_NAME, 'termuxai');
  assert.ok(REPL_PROMPT.includes('termuxai'));
});
```

(Add the `import` lines at the top of the test file with the existing imports.)

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/step5-markdown.test.js`
Expected: FAIL — `REPL_PROMPT` currently contains `'t-ai'`, not `'termuxai'`.

- [x] **Step 3: Update `src/cli/repl.js`**

Replace line 16:

```js
import { APP_NAME } from '../config/constants.js';
```

Then replace the `REPL_PROMPT` declaration (line 16 originally):

```js
export const REPL_PROMPT = `${ansi.cyan(APP_NAME)} ${ansi.bold('❯')} `;
```

(Original was: ``export const REPL_PROMPT = `${ansi.cyan('t-ai')} ${ansi.bold('❯')} `;``)

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/step5-markdown.test.js`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/cli/repl.js tests/step5-markdown.test.js
git commit -m "refactor(repl): derive REPL_PROMPT from APP_NAME constant"
```

---

## Task 5: Update `system-prompt.js` persona string

**Files:**
- Modify: `src/agent/system-prompt.js:63`

- [x] **Step 1: Verify the existing test still asserts the old name**

Run: `node --test tests/step4-session.test.js`
Expected: FAIL with `expected "..." to include "t-ai (Termux AI)"` — confirms the test still anchors on the old name and must be updated alongside the source.

(If it accidentally passes due to substrings, that's a sign the test isn't actually pinning the value — skip to Step 3.)

- [x] **Step 2: Update the source file**

In `src/agent/system-prompt.js` line 63, replace:

```js
You are t-ai (Termux AI), an autonomous, highly capable AI assistant and software engineering agent running directly inside the user's terminal environment (optimized for Termux Android and Linux).
```

with:

```js
You are termuxai (Termux AI), an autonomous, highly capable AI assistant and software engineering agent running directly inside the user's terminal environment (optimized for Termux Android and Linux).
```

- [x] **Step 3: Update the test in `tests/step4-session.test.js`**

Find the assertion at line 67:

```js
assert.ok(prompt.includes('t-ai (Termux AI)'));
```

Replace with:

```js
assert.ok(prompt.includes('termuxai (Termux AI)'));
```

Also update the temp dir fixture at line 162:

```js
tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-session-test-'));
```

→

```js
tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'termuxai-session-test-'));
```

- [x] **Step 4: Run tests to verify they pass**

Run: `node --test tests/step4-session.test.js`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/agent/system-prompt.js tests/step4-session.test.js
git commit -m "refactor(agent): rename persona from 't-ai' to 'termuxai'"
```

---

## Task 6: Update Gemini API key error message

**Files:**
- Modify: `src/llm/gemini.js:290`

- [x] **Step 1: Locate and replace the error message**

In `src/llm/gemini.js` line 290, replace:

```js
        'Gemini API key is not configured. Please set it using `t-ai config set apiKey <key>` or set GEMINI_API_KEY environment variable.'
```

with:

```js
        'Gemini API key is not configured. Please set it using `termuxai config set apiKey <key>` or set GEMINI_API_KEY environment variable.'
```

- [x] **Step 2: Verify no test pins the old message**

Run: `grep -rn "t-ai config set apiKey" tests/` from `C:\xampp\htdocs\faydev\ai-termux`
Expected: no matches (the existing tests do not pin this string). If any test does, update it.

- [x] **Step 3: Run all step-3 tests**

Run: `node --test tests/step3-retry.test.js tests/step3-stream.test.js`
Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/llm/gemini.js
git commit -m "refactor(llm): update API-key error message to use 'termuxai'"
```

---

## Task 7: Update `security/rules.js` ignore patterns

**Files:**
- Modify: `src/security/rules.js:2,67`

- [x] **Step 1: Verify the existing test does not assert ignore-pattern contents**

Run: `grep -rn "DEFAULT_IGNORE_PATTERNS\|\\.t-ai" tests/step2-security.test.js`
Expected: no match (the existing test does not pin the list of ignore patterns). If it does, update it.

- [x] **Step 2: Update source file**

In `src/security/rules.js`:

(a) Line 2 header comment: `Termux AI CLI (\`t-ai\`)` → `Termux AI CLI (\`termuxai\`)`.

(b) Line 67 inside `DEFAULT_IGNORE_PATTERNS`: `'.t-ai'` → `'.termuxai'`.

Final array:

```js
export const DEFAULT_IGNORE_PATTERNS = [
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '.cache',
  '.termuxai',
  '.next',
  '.nuxt',
  '__pycache__',
  '.venv',
  'venv',
  'coverage',
  '.DS_Store',
  'Thumbs.db'
];
```

- [x] **Step 3: Run step-2 tests**

Run: `node --test tests/step2-security.test.js tests/step2-tools.test.js`
Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/security/rules.js
git commit -m "refactor(security): update ignore pattern from .t-ai to .termuxai"
```

---

## Task 8: Update header comments (cosmetic, batch)

**Files:**
- Modify: `bin/tai.js:4`, `src/index.js:2`, `src/cli/help.js:2`, `src/cli/piping.js:3-4`, `src/agent/session.js:3`, `src/llm/index.js:2`, `src/utils/logger.js:2`

- [x] **Step 1: Replace each header comment**

For each of the files below, find the line containing `Termux AI CLI (\`t-ai\`)` (or similar with the project name) and replace with `Termux AI CLI (\`termuxai\`)`.

| File | Old text | New text |
|---|---|---|
| `bin/tai.js:4` | `Termux AI CLI (\`t-ai\` / \`tai\`) Executable Entrypoint` | `Termux AI CLI (\`termuxai\`) Executable Entrypoint` |
| `src/index.js:2` | `Termux AI CLI (\`t-ai\`) - Library Entrypoint` | `Termux AI CLI (\`termuxai\`) - Library Entrypoint` |
| `src/cli/help.js:2` | `Terminal Help Screen & Version Display for Termux AI CLI` (no change needed, no `t-ai`) | unchanged |
| `src/cli/piping.js:3-4` | `Reads streams from standard input when piped into \`t-ai\`` / `Example: \`cat error.log | t-ai "analisis masalah ini"\`` | `Reads streams from standard input when piped into \`termuxai\`` / `Example: \`cat error.log | termuxai "analisis masalah ini"\`` |
| `src/agent/session.js:3` | `Manages conversation history, session lifecycle, and disk storage at ~/.t-ai/sessions/` | `Manages conversation history, session lifecycle, and disk storage at ~/.termuxai/sessions/` |
| `src/llm/index.js:2` | `LLM Client Module for Termux AI CLI` (no `t-ai`) | unchanged |
| `src/utils/logger.js:2` | `Leveled Console Logger for Termux AI CLI` (no `t-ai`) | unchanged |

After edits, confirm no `t-ai` / `tai` references remain in these files (except inside the `bin/tai.js` filename strings, which is the actual disk filename and stays).

- [x] **Step 2: Verify the help.js banner still uses `APP_NAME` constant**

In `src/cli/help.js`, lines 20-22 already use `APP_NAME`. Confirm Task 1's constant change makes them render `termuxai` automatically. No code change needed.

- [x] **Step 3: Run all unit tests**

Run: `npm test`
Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add bin/tai.js src/index.js src/cli/help.js src/cli/piping.js src/agent/session.js src/llm/index.js src/utils/logger.js
git commit -m "docs: rename t-ai/tai references in header comments to termuxai"
```

---

## Task 9: Update `package.json` `bin` field — drop `t-ai` and `tai` aliases

**Files:**
- Modify: `package.json:7-10`

- [x] **Step 1: Edit `package.json`**

Replace the `bin` block:

```json
  "bin": {
    "t-ai": "./bin/tai.js",
    "tai": "./bin/tai.js"
  },
```

with:

```json
  "bin": {
    "termuxai": "./bin/tai.js"
  },
```

- [x] **Step 2: Verify `node bin/tai.js --version` still works**

Run: `node bin/tai.js --version`
Expected: prints the version banner (using `APP_FULL_NAME` which is unchanged) — confirms the binary path itself still resolves.

- [x] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat(package): replace t-ai/tai bins with termuxai"
```

---

## Task 10: Update `install.sh` — banner, symlinks, user-facing strings

**Files:**
- Modify: `install.sh` (multiple lines)

- [x] **Step 1: Replace header comment and banner text**

Line 3: `# Termux AI CLI (`t-ai`) — One-Command Installer` → `# Termux AI CLI (`termuxai`) — One-Command Installer`

Line 52: `echo -e "${BOLD}  Termux AI CLI (t-ai) — Installer${RESET}"` → `echo -e "${BOLD}  Termux AI CLI (termuxai) — Installer${RESET}"`

- [x] **Step 2: Update setup_directories() — T_AI_DIR → TERMUXAI_DIR, .t-ai → .termuxai**

Line 117: `log_step "Setting up t-ai directories"` → `log_step "Setting up termuxai directories"`

Line 119: `T_AI_DIR="$HOME/.t-ai"` → `TERMUXAI_DIR="$HOME/.termuxai"`

Line 120: `SESSIONS_DIR="$T_AI_DIR/sessions"` → `SESSIONS_DIR="$TERMUXAI_DIR/sessions"`

Line 122: `mkdir -p "$T_AI_DIR"` → `mkdir -p "$TERMUXAI_DIR"`

Line 123: `chmod 700 "$T_AI_DIR"` → `chmod 700 "$TERMUXAI_DIR"`

Line 128: `log_success "Config directory: $T_AI_DIR"` → `log_success "Config directory: $TERMUXAI_DIR"`

Line 136: `log_info "To allow t-ai to access /sdcard, run: termux-setup-storage"` → `log_info "To allow termuxai to access /sdcard, run: termux-setup-storage"`

- [x] **Step 3: Rename function `install_tai` → `install_termuxai` and update its log lines**

Line 141: `# ── Install t-ai ───...` → `# ── Install termuxai ───...`

Line 142: `install_tai() {` → `install_termuxai() {`

Line 143: `log_step "Installing t-ai CLI"` → `log_step "Installing termuxai CLI"`

Line 165: `log_info "Linking t-ai globally via npm..."` → `log_info "Linking termuxai globally via npm..."`

Line 169: `log_success "t-ai linked globally via npm link"` → `log_success "termuxai linked globally via npm link"`

Line 173: `log_success "t-ai installed globally via npm install -g"` → `log_success "termuxai installed globally via npm install -g"`

Line 263: `install_tai` → `install_termuxai` (function call site)

- [x] **Step 4: Update create_symlink — drop `t-ai` and `tai` symlinks, keep only `termuxai`**

Line 184: variable `local TAI_BIN="$1"` — unchanged (just a local var).

Lines 199-201 — replace:

```bash
  # Create symlinks for both t-ai and tai
  ln -sf "$TAI_BIN" "$LINK_DIR/t-ai" 2>/dev/null || true
  ln -sf "$TAI_BIN" "$LINK_DIR/tai" 2>/dev/null || true
```

with:

```bash
  # Create symlink for termuxai command
  ln -sf "$TAI_BIN" "$LINK_DIR/termuxai" 2>/dev/null || true
```

- [x] **Step 5: Update post_install() — verification and guide text**

Line 211-217 — replace:

```bash
  if command -v t-ai &>/dev/null; then
    TAI_VERSION=$(t-ai --version 2>/dev/null || echo "unknown")
    log_success "t-ai command is available: t-ai $TAI_VERSION"
  elif command -v tai &>/dev/null; then
    log_success "tai command is available"
  else
    log_warn "Could not find t-ai in PATH. You may need to restart your terminal."
    log_info "Try: hash -r  (to reload PATH)"
  fi
```

with:

```bash
  if command -v termuxai &>/dev/null; then
    TERMUXAI_VERSION=$(termuxai --version 2>/dev/null || echo "unknown")
    log_success "termuxai command is available: termuxai $TERMUXAI_VERSION"
  else
    log_warn "Could not find termuxai in PATH. You may need to restart your terminal."
    log_info "Try: hash -r  (to reload PATH)"
  fi
```

Line 227: `echo -e "     ${CYAN}t-ai config set apiKey YOUR_GEMINI_API_KEY${RESET}"` → `echo -e "     ${CYAN}termuxai config set apiKey YOUR_GEMINI_API_KEY${RESET}"`

Line 234: `echo -e "     ${CYAN}t-ai${RESET}  or  ${CYAN}tai${RESET}"` → `echo -e "     ${CYAN}termuxai${RESET}"`

Line 237: `echo -e "     ${CYAN}t-ai \"Buat fungsi add(a, b) di JavaScript\"${RESET}"` → `echo -e "     ${CYAN}termuxai \"Buat fungsi add(a, b) di JavaScript\"${RESET}"`

Line 240: `echo -e "     ${CYAN}cat error.log | t-ai \"Analisis IP mencurigakan\"${RESET}"` → `echo -e "     ${CYAN}cat error.log | termuxai \"Analisis IP mencurigakan\"${RESET}"`

Line 241: `echo -e "     ${CYAN}git diff | t-ai \"Buat pesan commit\"${RESET}"` → `echo -e "     ${CYAN}git diff | termuxai \"Buat pesan commit\"${RESET}"`

Line 244: `echo -e "     ${CYAN}t-ai --help${RESET}"` → `echo -e "     ${CYAN}termuxai --help${RESET}"`

- [x] **Step 6: Verify no `t-ai` remains in user-facing strings**

Run: `grep -n "t-ai" install.sh`
Expected: no matches in user-facing output. (The function internal vars `TAI_BIN` are fine; nothing else should remain.)

Run: `grep -n "tai " install.sh`
Expected: only matches inside the `TERMUXAI` substring or `TAI_BIN` var name. No standalone `tai ` references.

- [x] **Step 7: Syntax-check the script**

Run: `bash -n install.sh`
Expected: no errors.

- [x] **Step 8: Commit**

```bash
git add install.sh
git commit -m "feat(install): rename installer references from t-ai to termuxai"
```

---

## Task 11: Update `scripts/benchmark.js` and `scripts/test-e2e.js`

**Files:**
- Modify: `scripts/benchmark.js:4,24,67,76,124,297`
- Modify: `scripts/test-e2e.js:4`

- [x] **Step 1: Update `benchmark.js`**

Line 4: `Termux AI CLI (`t-ai`) — Performance Benchmark Script` → `Termux AI CLI (`termuxai`) — Performance Benchmark Script`

Line 24: `const ENTRY = path.join(ROOT_DIR, 'bin', 'tai.js');` — unchanged (binary filename).

Line 67: `// Spawns \`node bin/tai.js --version\` and measures wall-clock time` → `// Spawns \`node bin/termuxai.js --version\` and measures wall-clock time` (cosmetic; just describes the path)

Line 76: `env: { ...process.env, T_AI_CONFIG_DIR: path.join(ROOT_DIR, '.benchmark-tmp') },` → `env: { ...process.env, TERMUXAI_CONFIG_DIR: path.join(ROOT_DIR, '.benchmark-tmp') },`

Line 124: same env change.

Line 297: `— t-ai meets PRD performance targets.` → `— termuxai meets PRD performance targets.`

- [x] **Step 2: Update `test-e2e.js`**

Line 4: `Termux AI CLI (`t-ai`) — E2E Test Runner` → `Termux AI CLI (`termuxai`) — E2E Test Runner`

- [x] **Step 3: Run benchmark to verify it still works**

Run: `npm run benchmark`
Expected: benchmarks run, all PASS, final message contains "termuxai meets PRD performance targets."

- [x] **Step 4: Commit**

```bash
git add scripts/benchmark.js scripts/test-e2e.js
git commit -m "refactor(scripts): rename references in benchmark and e2e runner"
```

---

## Task 12: Update remaining test fixtures (cosmetic temp-dir names)

**Files:**
- Modify: `tests/step1-args.test.js:80-86`
- Modify: `tests/step2-security.test.js:14,55`
- Modify: `tests/step2-tools.test.js:19`
- Modify: `tests/step3-stream.test.js:93,101`
- Modify: `tests/step4-orchestrator.test.js:22,36,57,65`
- Modify: `tests/e2e/e2e-piping.test.js:63`
- Modify: `tests/e2e/e2e-self-healing.test.js:38`
- Modify: `tests/e2e/e2e-session-resume.test.js:30`

- [x] **Step 1: Update `tests/step1-args.test.js`**

Lines 80, 82, 84, 86 — replace each `/tmp/test-tai` and `/tmp/other-tai` with `/tmp/test-termuxai` and `/tmp/other-termuxai` respectively.

- [x] **Step 2: Update `tests/step2-security.test.js`**

Line 14: `'tai-sec-test-'` → `'termuxai-sec-test-'`
Line 55: `'tai-extra-'` → `'termuxai-extra-'`

- [x] **Step 3: Update `tests/step2-tools.test.js`**

Line 19: `'tai-tools-test-'` → `'termuxai-tools-test-'`

- [x] **Step 4: Update `tests/step3-stream.test.js`**

Line 93 (in the SSE fixture string): `".t-ai/config.json"` → `".termuxai/config.json"`
Line 101: `.t-ai/config.json` → `.termuxai/config.json`

- [x] **Step 5: Update `tests/step4-orchestrator.test.js`**

Line 22: `'tai-orchestrator-test-'` → `'termuxai-orchestrator-test-'`
Lines 36, 57, 65: `'Saya asisten t-ai'` → `'Saya asisten termuxai'`

- [x] **Step 6: Update e2e fixtures**

`tests/e2e/e2e-piping.test.js:63`: `'tai-e2e-piping-'` → `'termuxai-e2e-piping-'`
`tests/e2e/e2e-self-healing.test.js:38`: `'tai-e2e-selfheal-'` → `'termuxai-e2e-selfheal-'`
`tests/e2e/e2e-session-resume.test.js:30`: `'tai-e2e-session-'` → `'termuxai-e2e-session-'`

- [x] **Step 7: Run all unit + e2e tests**

Run: `npm run test:all`
Expected: all PASS.

- [x] **Step 8: Commit**

```bash
git add tests/step1-args.test.js tests/step2-security.test.js tests/step2-tools.test.js tests/step3-stream.test.js tests/step4-orchestrator.test.js tests/e2e/
git commit -m "test: rename tai/t-ai references in test fixtures"
```

---

## Task 13: Update `bin/tai.js` user-facing error messages

**Files:**
- Modify: `bin/tai.js:58,73,83,124,145`

- [x] **Step 1: Replace error messages**

Line 58: `logger.error('Missing configuration key. Usage: t-ai config get <key>');` → `logger.error('Missing configuration key. Usage: termuxai config get <key>');`

Line 73: `logger.error('Missing key or value. Usage: t-ai config set <key> <val>');` → `logger.error('Missing key or value. Usage: termuxai config set <key> <val>');`

Line 83: `logger.error('Missing configuration key. Usage: t-ai config delete <key>');` → `logger.error('Missing configuration key. Usage: termuxai config delete <key>');`

Line 124: `logger.error('Missing session ID. Usage: t-ai session delete <session-id>');` → `logger.error('Missing session ID. Usage: termuxai session delete <session-id>');`

Line 145: `${ansi.green('t-ai config set apiKey <your-gemini-api-key>')}` → `${ansi.green('termuxai config set apiKey <your-gemini-api-key>')}`

- [x] **Step 2: Smoke test help output**

Run: `node bin/tai.js --help`
Expected: banner shows `termuxai`, examples and subcommand labels all say `termuxai`.

Run: `node bin/tai.js --version`
Expected: version banner displays without crashing.

- [x] **Step 3: Commit**

```bash
git add bin/tai.js
git commit -m "refactor(bin): rename t-ai references in error/help text to termuxai"
```

---

## Task 14: Update `README.md`

**Files:**
- Modify: `README.md` (many lines)

- [x] **Step 1: Replace title and global command references**

Line 1 title: `# Termux AI CLI (`t-ai`)` → `# Termux AI CLI (`termuxai`)`

- [x] **Step 2: Update Installation section (Android Termux, Linux/macOS, Windows)**

Lines 32-56: every `npm link` command stays; no `t-ai` literal to replace in install steps. Confirm by `grep` after edit.

- [x] **Step 3: Update Quick Start section (lines 81-99)**

Line 83: `# Start interactive REPL` (no command literal in comment) — confirm.
Line 84: `t-ai` (the bare command) → `termuxai`
Line 86: `t-ai "Buat fungsi...` → `termuxai "Buat fungsi...`
Line 89: `cat error.log | t-ai "Analisis...` → `cat error.log | termuxai "Analisis...`
Line 92: `git diff | t-ai "Buat pesan...` → `git diff | termuxai "Buat pesan...`
Line 95: `t-ai --model gemini-2.5-pro "Refaktor...` → `termuxai --model gemini-2.5-pro "Refaktor...`
Line 98: `t-ai -y "Instal...` → `termuxai -y "Instal...`

- [x] **Step 4: Update Usage Modes — Interactive REPL Mode banner (lines 110-118)**

Line 110: `$ t-ai` → `$ termuxai`
Line 113: `t-ai — Termux AI CLI  (gemini-2.5-flash)` → `termuxai — Termux AI CLI  (gemini-2.5-flash)`

- [x] **Step 5: Update Mode 2 Single-Shot example (line 134)**

`# t-ai "YOUR_TASK_HERE"` → `# termuxai "YOUR_TASK_HERE"`

- [x] **Step 6: Update UNIX Pipe Mode (lines 140-151)**

Replace every `t-ai` literal with `termuxai`. Examples use `t-ai "..."` in three places.

- [x] **Step 7: Update Session Management (lines 156-171)**

Line 158: `t-ai session list` → `termuxai session list`
Line 161: `t-ai resume ...` → `termuxai resume ...`
Line 164: `t-ai session delete ...` → `termuxai session delete ...`
Line 167: `t-ai session clear` → `termuxai session clear`
Line 170: `t-ai --session ...` → `termuxai --session ...`

- [x] **Step 8: Update Configuration section (lines 180-198)**

Replace every `t-ai config ...` with `termuxai config ...` (10+ occurrences).

- [x] **Step 9: Update Security section (lines 226-265)**

Line 226: `t-ai includes a multi-layer security guard...` → `termuxai includes a multi-layer security guard...`
Line 244: `[SECURITY CHECK] AI wants to execute risky shell command:` (no command name) — unchanged.
Lines 253, 254: `t-ai -y "..."` / `t-ai --yes "..."` → `termuxai -y "..."` / `termuxai --yes "..."`
Line 259: `t-ai automatically permits access to Android shared storage paths` → `termuxai automatically permits access to Android shared storage paths`

- [x] **Step 10: Update Self-Healing Bug Fix Example (line 338)**

`t-ai "Buat file kalkulator..."` → `termuxai "Buat file kalkulator..."`
Line 343: `t-ai will autonomously:` → `termuxai will autonomously:`

- [x] **Step 11: Update Troubleshooting section (lines 510-561)**

Line 513: `t-ai config set apiKey YOUR_KEY` → `termuxai config set apiKey YOUR_KEY`
Line 516: `export GEMINI_API_KEY="YOUR_KEY"` (no change)
Line 522: `chmod +x bin/tai.js` (no change — file path)
Line 525: `t-ai command not found after install` → `termuxai command not found after install`
Line 536: `ls $PREFIX/bin/t-ai` → `ls $PREFIX/bin/termuxai`
Line 544: `node --jitless bin/tai.js` (no change — file path)
Line 551: `t-ai config set model gemini-1.5-flash` → `termuxai config set model gemini-1.5-flash`

- [x] **Step 12: Update Configuration keys table (lines 200-210)**

The table describes config keys (`apiKey`, `model`, etc.). If the description column mentions `T_AI_*` env vars, update those. Specifically:
- Add a new row documenting `TERMUXAI_API_KEY` and `TERMUXAI_CONFIG_DIR` as the primary env vars.
- Note `T_AI_API_KEY` / `T_AI_CONFIG_DIR` and `~/.t-ai/` are deprecated legacy.

- [x] **Step 13: Update CLI Reference section (lines 463-503)**

Line 466: `Usage: t-ai [OPTIONS] [PROMPT]` / `tai [OPTIONS] [PROMPT]` → `Usage: termuxai [OPTIONS] [PROMPT]`

Lines 470-503: every `t-ai` literal → `termuxai`. Drop the `tai` alias entirely.

Line 501: `T_AI_API_KEY` → `TERMUXAI_API_KEY` (primary) — add a note for legacy `T_AI_API_KEY`.
Line 502: `T_AI_CONFIG_DIR` → `TERMUXAI_CONFIG_DIR` (primary) — add a legacy note.

- [x] **Step 14: Update Performance section (lines 354-370)**

Line 354: `t-ai is engineered...` → `termuxai is engineered...`
Line 367: `# Startup Time (avg)    142.35 ms     < 300 ms    ✔ PASS` — unchanged.

- [x] **Step 15: Final sweep**

Run: `grep -n "t-ai" README.md` and `grep -n "\btai\b" README.md`
Expected: zero matches for `t-ai`; `tai` only appears if intentionally retained (it shouldn't).

- [x] **Step 16: Commit**

```bash
git add README.md
git commit -m "docs(readme): rename all t-ai/tai command references to termuxai"
```

---

## Task 15: Update `AI Termux.md` PRD references

**Files:**
- Modify: `AI Termux.md` (PRD)

- [x] **Step 1: Grep PRD for old command name**

Run: `grep -nE "t-ai|\btai\b|T_AI|TAI" "AI Termux.md"`
Expected: list every line with old references.

- [x] **Step 2: Replace each match with `termuxai` / `TERMUXAI_*`**

For every line returned above, change command-name tokens. Preserve any non-name context.

Specifically: anywhere the doc shows a sample command invocation like `t-ai "task"`, change to `termuxai "task"`. Anywhere it mentions env vars like `T_AI_API_KEY`, keep it as legacy-note only — but if it's a primary reference, change to `TERMUXAI_API_KEY`.

- [x] **Step 3: Final sweep**

Run: `grep -nE "t-ai|T_AI" "AI Termux.md"`
Expected: only legacy-note lines (if any) remain. None should remain as primary references.

- [x] **Step 4: Commit**

```bash
git add "AI Termux.md"
git commit -m "docs(prd): rename t-ai command references in PRD to termuxai"
```

---

## Task 16: Update `plans/` step documents

**Files:**
- Modify: `plans/STEP_1_FOUNDATION_CONFIG.md`
- Modify: `plans/STEP_2_SECURITY_TOOLS.md`
- Modify: `plans/STEP_3_LLM_STREAMING.md`
- Modify: `plans/STEP_4_REACT_AGENT_SESSION.md`
- Modify: `plans/STEP_5_REPL_UI_PIPING.md`
- Modify: `plans/STEP_6_INTEGRATION_TERMUX_PACKAGING.md`
- Modify: `plans/MASTER_PLAN.md`

- [x] **Step 1: Sweep all step plans**

Run from `C:\xampp\htdocs\faydev\ai-termux`:

```bash
grep -nE "t-ai|\btai\b|T_AI|TAI" plans/*.md
```

Expected: lists every line across all step plans that still references the old command name.

- [x] **Step 2: Replace each match**

For every line, change `t-ai` → `termuxai` and `T_AI_*` → `TERMUXAI_*` (primary) or note as legacy if it's a backward-compat reference.

Pay special attention to:
- Code blocks showing example commands
- Configuration tables
- Architectural descriptions mentioning the "CLI command name"

- [x] **Step 3: Final sweep**

```bash
grep -nE "t-ai|T_AI" plans/*.md
```

Expected: only intentional legacy/backward-compat notes remain. No primary references to `t-ai` / `T_AI_*`.

- [x] **Step 4: Commit**

```bash
git add plans/
git commit -m "docs(plans): rename t-ai/T_AI references in step plans to termuxai"
```

---

## Task 17: Final verification sweep

- [x] **Step 1: Full unit + e2e test suite**

Run: `npm run test:all`
Expected: all PASS.

- [x] **Step 2: Run benchmark**

Run: `npm run benchmark`
Expected: all benchmarks PASS, final message contains "termuxai meets PRD performance targets."

- [x] **Step 3: Smoke test CLI**

Run:

```bash
node bin/tai.js --version
node bin/tai.js --help
node bin/tai.js config list
```

Expected:
- `--version` prints version banner
- `--help` shows `termuxai` in USAGE, EXAMPLES, CONFIG COMMANDS sections
- `config list` runs without error (writes to `~/.termuxai/config.json`)

- [x] **Step 4: Legacy fallback smoke test**

Set only the old env var:

```bash
T_AI_API_KEY=legacy-test node -e "
  import('./src/config/manager.js').then(m => {
    const cm = new m.ConfigManager();
    console.log('Resolved key:', cm.getApiKey());
  });
"
```

Expected: prints `Resolved key: legacy-test`.

- [x] **Step 5: Confirm `package.json` bin field has only `termuxai`**

Run: `cat package.json | grep -A 3 '"bin"'`
Expected: only `"termuxai": "./bin/tai.js"`.

- [x] **Step 6: Confirm `install.sh` creates only `termuxai` symlink**

Run: `grep -n "ln -sf" install.sh`
Expected: single line creating `$LINK_DIR/termuxai`.

- [x] **Step 7: Final commit (if any verification-only changes occurred)**

```bash
git status
```

If nothing dirty, skip. Otherwise commit with `chore: post-rename verification cleanup`.

---

## Out of Scope (explicitly excluded)

- GitHub repo rename (`ai-termux` → `termuxai`). Requires GitHub-side action.
- npm package rename (`termux-ai-cli` → `termuxai`). Requires unpublish/republish.
- `bin/tai.js` filename rename. Internal path, not user-visible.
- Refactoring `src/cli/single-shot.js` (no name references).

## Notes

- The `APP_NAME` constant is now the single source of truth for the command name in `src/cli/help.js` and `src/cli/repl.js`. Future renames require only Task 1 + a comment sweep.
- Backward compat: users with `T_AI_API_KEY` / `T_AI_CONFIG_DIR` / `~/.t-ai/` keep working — the new names take priority but the old ones still resolve. No data migration needed.
- The `install.sh` script's old behavior was to create both `t-ai` and `tai` symlinks. After this change, only `termuxai` is created. Users with old installations who want `termuxai` need to re-run install.sh or symlink manually.
