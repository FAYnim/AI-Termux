# CLI Rename: `termuxai` → `faycli` (FAY CLI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand the entire CLI from `termuxai` to `faycli` (FAY CLI) — binary name, npm package, config dir, env vars, user-facing strings, docs, tests, scripts — with one-time auto-migration of user data from `~/.termuxai` to `~/.faycli`.

**Architecture:** Central rename of `APP_NAME`/`APP_FULL_NAME`/`DEFAULT_CONFIG_DIR_NAME` constants drives most display strings (help, REPL prompt, usage errors source from constants). Binary name, package name, env vars, config dir, and docs are updated in place. A copy-based one-time migration in `ConfigManager.getConfigDir()` preserves user data at the old path.

**Tech Stack:** Node.js 20+ ESM, built-in `node:test`, no runtime deps. Uses `fs.cpSync` (Node ≥16.7) for migration.

**Spec:** `docs/superpowers/specs/2026-09-01-cli-rename-design.md`

---

## File Structure

Modified files and their responsibility:

| File | Change |
|------|--------|
| `src/config/constants.js` | `APP_NAME`→`faycli`, `APP_FULL_NAME`→`fay-cli`, `DEFAULT_CONFIG_DIR_NAME`→`.faycli`, gemini envVars `TERMUXAI_API_KEY`→`FAYCLI_API_KEY` |
| `src/config/manager.js` | env var `TERMUXAI_CONFIG_DIR`→`FAYCLI_CONFIG_DIR`; add copy migration `~/.termuxai`→`~/.faycli` |
| `src/utils/termux.js` | `getConfigRoot()` uses `.faycli` |
| `bin/tai.js` | header comment + all usage/error strings |
| `src/cli/help.js` | header comment |
| `src/cli/model-commands.js` | 3 usage strings |
| `src/cli/piping.js` | header comment + examples |
| `src/cli/repl.js` | (auto via APP_NAME) |
| `src/agent/system-prompt.js` | "You are termuxai (Termux AI)" → "You are faycli (FAY CLI)" |
| `src/agent/session.js` | header comment |
| `src/llm/gemini.js`, `src/llm/openai.js` | API-key error message strings |
| `src/llm/registry.js`, `src/llm/index.js` | header comments |
| `src/security/rules.js` | header comment + `.termuxai`→`.faycli` in default blocked dirs |
| `src/security/path-validator.js` | comment string |
| `src/index.js`, `src/utils/logger.js` | header comments |
| `package.json` | `name`→`faycli`, `bin`→`{ "faycli": "./bin/tai.js" }` |
| `install.sh` | `TERMUXAI_DIR`→`FAYCLI_DIR`, `$HOME/.termuxai`→`$HOME/.faycli` |
| `.gitignore` | `.termuxai/`→`.faycli/` |
| `README.md`, `CHANGELOG.md`, `SECURITY.md` | all references |
| `scripts/benchmark.js`, `scripts/test-e2e.js` | header comments + banner strings |
| `tests/*` | expectations + temp dir names |
| `docs/superpowers/plans/*-unlimited-loop-compact.md` | temp-dir prefixes (doc only) |

---

## Task 1: Constants — single source of truth

**Files:**
- Modify: `src/config/constants.js:14,17-18,23,74`

- [ ] **Step 1: Edit constants**

Change:
```js
 * Termux AI CLI (`termuxai`)
export const APP_NAME = 'termuxai';
export const APP_FULL_NAME = 'termux-ai-cli';
```
to:
```js
 * FAY CLI (`faycli`)
export const APP_NAME = 'faycli';
export const APP_FULL_NAME = 'fay-cli';
```

Change line 23:
```js
export const DEFAULT_CONFIG_DIR_NAME = '.termuxai';
```
to:
```js
export const DEFAULT_CONFIG_DIR_NAME = '.faycli';
```

Change gemini envVars (line 74) — drop legacy `TERMUXAI_API_KEY`, keep `T_AI_API_KEY`:
```js
envVars: ['GEMINI_API_KEY', 'TERMUXAI_API_KEY', 'T_AI_API_KEY'],
```
to:
```js
envVars: ['GEMINI_API_KEY', 'FAYCLI_API_KEY', 'T_AI_API_KEY'],
```

- [ ] **Step 2: Verify no stray old constants**

Run: `grep -rn "termuxai\|termux-ai-cli" src/config/constants.js`
Expected: no output.

- [ ] **Step 3: Run tests**

Run: `npm test -- --test-name-pattern "utils-termux|step5-markdown" 2>&1 | tail -20`
Expected: FAIL — tests still assert old `'.termuxai'` / `'termuxai'`. That's the expected red; Task 8 updates those tests.

- [ ] **Step 4: Commit**

```bash
git add src/config/constants.js
git commit -m "refactor(config): rename APP_NAME to faycli, config dir to .faycli"
```

---

## Task 2: `package.json` — name & bin

**Files:**
- Modify: `package.json:2,8`

- [ ] **Step 1: Edit package.json**

```json
  "name": "termux-ai-cli",
```
→
```json
  "name": "faycli",
```
```json
  "bin": {
    "termuxai": "./bin/tai.js"
  },
```
→
```json
  "bin": {
    "faycli": "./bin/tai.js"
  },
```

- [ ] **Step 2: Verify pack**

Run: `npm pack --dry-run 2>&1 | grep -i "bin\|name" | head`
Expected: shows `faycli`, no `termuxai` bin entry.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(package): rename npm package to faycli, bin to faycli"
```

---

## Task 3: Config migration in `manager.js`

**Files:**
- Modify: `src/config/manager.js:2,74,81-82,92-98`

**Goal:** env var `TERMUXAI_CONFIG_DIR`→`FAYCLI_CONFIG_DIR`, and auto-migrate `~/.termuxai`→`~/.faycli` (copy, one-time) before the legacy `~/.t-ai` fallback.

- [ ] **Step 1: Write failing migration test first**

Create `tests/step1-config-migrate.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigManager } from '../src/config/manager.js';

test('migrates ~/.termuxai to ~/.faycli when .faycli missing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'faycli-home-'));
  const oldDir = path.join(home, '.termuxai');
  fs.mkdirSync(path.join(oldDir, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(oldDir, 'config.json'), JSON.stringify({ activeProvider: 'gemini' }));
  fs.writeFileSync(path.join(oldDir, 'sessions', 's1.json'), '{}');

  const oldHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const mgr = new ConfigManager();
    const dir = mgr.getConfigDir();
    assert.equal(path.basename(dir), '.faycli');
    assert.ok(fs.existsSync(path.join(dir, 'config.json')), 'config.json copied');
    assert.ok(fs.existsSync(path.join(dir, 'sessions', 's1.json')), 'sessions copied');
    assert.ok(fs.existsSync(oldDir), 'old dir kept as backup');
  } finally {
    process.env.HOME = oldHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('does NOT migrate when .faycli already exists', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'faycli-home2-'));
  const oldDir = path.join(home, '.termuxai');
  const newDir = path.join(home, '.faycli');
  fs.mkdirSync(oldDir, { recursive: true });
  fs.writeFileSync(path.join(oldDir, 'config.json'), JSON.stringify({ activeProvider: 'old' }));
  fs.mkdirSync(newDir, { recursive: true });
  fs.writeFileSync(path.join(newDir, 'config.json'), JSON.stringify({ activeProvider: 'new' }));

  const oldHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const mgr = new ConfigManager();
    const dir = mgr.getConfigDir();
    assert.equal(path.basename(dir), '.faycli');
    const cfg = mgr.loadConfig();
    assert.equal(cfg.activeProvider, 'new', 'new dir wins, no overwrite');
  } finally {
    process.env.HOME = oldHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/step1-config-migrate.test.js`
Expected: FAIL — `path.basename(dir)` is `'.termuxai'` because old constant still used.

- [ ] **Step 3: Implement migration in manager.js**

Header comment (line 2):
```js
 * Configuration Manager for FAY CLI
```

`getConfigDir()` — replace lines 74–99:

```js
  /**
   * Resolve root configuration directory
   * Priority: customConfigDir > process.env.FAYCLI_CONFIG_DIR > process.env.T_AI_CONFIG_DIR > os.homedir()/.faycli (auto-migrate from ~/.termuxai) > ~/.t-ai > fallback
   * @returns {string}
   */
  getConfigDir() {
    if (this.customConfigDir) {
      return path.resolve(this.customConfigDir);
    }
    if (process.env.FAYCLI_CONFIG_DIR) {
      return path.resolve(process.env.FAYCLI_CONFIG_DIR);
    }
    // Legacy env-var fallback for users upgrading from t-ai
    if (process.env.T_AI_CONFIG_DIR) {
      return path.resolve(process.env.T_AI_CONFIG_DIR);
    }

    const homeDir =
      process.env.HOME || process.env.USERPROFILE || os.homedir() || TERMUX_HOME_FALLBACK;
    const primaryDir = path.join(homeDir, DEFAULT_CONFIG_DIR_NAME);
    // One-time migration: if ~/.faycli doesn't exist but ~/.termuxai does,
    // copy old data in (implicit backup — old dir left intact).
    const legacyTermuxaiDir = path.join(homeDir, '.termuxai');
    if (!fs.existsSync(primaryDir) && fs.existsSync(legacyTermuxaiDir)) {
      fs.cpSync(legacyTermuxaiDir, primaryDir, { recursive: true });
    }
    // Legacy t-ai fallback: only when neither new nor migrated dir exists
    const legacyTaiDir = path.join(homeDir, '.t-ai');
    if (!fs.existsSync(primaryDir) && fs.existsSync(legacyTaiDir)) {
      return legacyTaiDir;
    }
    return primaryDir;
  }
```

- [ ] **Step 4: Run migration test to verify it passes**

Run: `node --test tests/step1-config-migrate.test.js`
Expected: PASS (both cases).

- [ ] **Step 5: Run existing config tests**

Run: `node --test tests/step1-config.test.js`
Expected: 1 FAIL — line 157 test "should fall back to legacy ~/.t-ai directory when ~/.termuxai does not exist" has an outdated comment and expects old behavior; the env-var and API-key assertions at lines 95–122 use `TERMUXAI_API_KEY` which Task 1 renamed. Fix in Task 8.

- [ ] **Step 6: Commit**

```bash
git add tests/step1-config-migrate.test.js src/config/manager.js
git commit -m "feat(config): rename FAYCLI_CONFIG_DIR env var, auto-migrate ~/.termuxai to ~/.faycli"
```

---

## Task 4: `termux.js` config root

**Files:**
- Modify: `src/utils/termux.js:66-75`

- [ ] **Step 1: Edit getConfigRoot**

```js
 * Resolve the faycli configuration root directory.
 * On Termux: `~/.faycli` under Termux home.
 * On other platforms: `~/.faycli` under os.homedir().
 *
 * @returns {string}
 */
export function getConfigRoot() {
  const home = getTermuxHome();
  return path.join(home, '.faycli');
}
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/termux.js
git commit -m "refactor(utils): getConfigRoot uses .faycli"
```

---

## Task 5: CLI entrypoint & command strings

**Files:**
- Modify: `bin/tai.js:4,59,74,86,129,167,178,208,264,299`

- [ ] **Step 1: Edit header comment (line 4)**

```js
 * FAY CLI (`faycli`)
```

- [ ] **Step 2: Replace all usage/error strings**

Replace each `termuxai` with `faycli` in these strings:
- line 59: `'Missing configuration key. Usage: termuxai config get <key>'`
- line 74: `'Missing key or value. Usage: termuxai config set <key> <val>'`
- line 86: `'Missing configuration key. Usage: termuxai config delete <key>'`
- line 129: `'Missing session ID. Usage: termuxai session delete <session-id>'`
- line 167: `'Missing provider id. Usage: termuxai provider use <id>'`
- line 178: `'Missing provider id. Usage: termuxai provider add <id>'`
- line 208: `'Missing provider id. Usage: termuxai provider remove <id>'`
- line 264: `... run 'termuxai provider add <id>'.`
- line 299: `` ${ansi.green(`termuxai provider add ${effectiveProvider} --api-key <key>`)} ``

- [ ] **Step 3: Verify**

Run: `grep -n "termuxai" bin/tai.js`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add bin/tai.js
git commit -m "refactor(cli): rename usage strings termuxai -> faycli"
```

---

## Task 6: `src/cli/*` strings

**Files:**
- Modify: `src/cli/model-commands.js:189,252,320`
- Modify: `src/cli/piping.js:3-4`
- Modify: `src/cli/help.js:2`

- [ ] **Step 1: model-commands.js usage strings**

Replace `termuxai model --set` → `faycli model --set`, `termuxai model --add`, `termuxai model --remove` at lines 189, 252, 320. (REPL/help display already sources from `APP_NAME`.)

- [ ] **Step 2: piping.js header/examples**

```js
 * Reads streams from standard input when piped into `faycli`
 * Example: `cat error.log | faycli "analisis masalah ini"`
```

- [ ] **Step 3: help.js header**

```js
 * Terminal Help Screen & Version Display for FAY CLI
```

- [ ] **Step 4: Verify**

Run: `grep -rn "termuxai" src/cli/`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/cli/
git commit -m "refactor(cli): rename user-facing strings to faycli"
```

---

## Task 7: Agent & LLM & security strings

**Files:**
- Modify: `src/agent/system-prompt.js:62`
- Modify: `src/agent/session.js:3`
- Modify: `src/llm/gemini.js:313`
- Modify: `src/llm/openai.js:391`
- Modify: `src/llm/registry.js:7`
- Modify: `src/llm/index.js:2`
- Modify: `src/security/rules.js:2,110`
- Modify: `src/security/path-validator.js:55`
- Modify: `src/index.js:2`
- Modify: `src/utils/logger.js:2`

- [ ] **Step 1: system-prompt.js identity**

```js
You are faycli (FAY CLI), an autonomous, highly capable AI assistant and software engineering agent running directly inside the user's terminal environment (optimized for Termux Android and Linux).
```

- [ ] **Step 2: session.js header**

```js
 * Manages conversation history, session lifecycle, and disk storage at ~/.faycli/sessions/
```

- [ ] **Step 3: gemini.js / openai.js error messages**

gemini.js line 313:
```js
'Gemini API key is not configured. Please set it using `faycli config set apiKey <key>` or set GEMINI_API_KEY environment variable.',
```
openai.js line 391:
```js
"OpenAI API key is not configured. Set OPENAI_API_KEY or run 'faycli provider add openai'.",
```

- [ ] **Step 4: security rules.js**

Header (line 2): `Security Rules & Pattern Definitions for FAY CLI (`faycli`)`
Line 110: `'.termuxai'` → `'.faycli'`

- [ ] **Step 5: remaining header comments**

- `src/llm/registry.js:7`: "FAY CLI features 2 native LLM client adapters:"
- `src/llm/index.js:2`: `LLM Client Module for FAY CLI`
- `src/security/path-validator.js:55`: `` Enable explicitly via `faycli config set security.allowTermuxStorage true`. ``
- `src/index.js:2`: `FAY CLI (`faycli`) - Library Entrypoint`
- `src/utils/logger.js:2`: `Leveled Console Logger for FAY CLI`

- [ ] **Step 6: Verify + commit**

Run: `grep -rn "termuxai" src/`
Expected: no output.
```bash
git add src/
git commit -m "refactor(src): rename agent/llm/security strings to faycli"
```

---

## Task 8: Tests

**Files:**
- Modify: all files below
- Add: `tests/step1-config-migrate.test.js` (done in Task 3)

- [ ] **Step 1: Update each test file**

For each occurrence, replace `termuxai` with `faycli` (temp-dir prefixes are cosmetic; assertions are functional):

| File | Change |
|------|--------|
| `tests/step1-utils-termux.test.js:10` | `DEFAULT_CONFIG_DIR_NAME` === `'.faycli'` |
| `tests/step5-markdown.test.js:289-290` | `APP_NAME` === `'faycli'`; `REPL_PROMPT.includes('faycli')` |
| `tests/step4-session.test.js:56` | `prompt.includes('faycli (FAY CLI)')` |
| `tests/step1-config.test.js:95,120` | `process.env.TERMUXAI_API_KEY` → `FAYCLI_API_KEY`; fix `~/.t-ai` fallback test comment (line 157) to `~/.termuxai` now migrates, so construct sandbox with `.faycli` absent and only `.t-ai` present |
| `tests/step1-config.test.js:157-164` | change comment "Intentionally do NOT create .termuxai" → "Create only .t-ai; no .faycli and no .termuxai so t-ai fallback triggers" |
| `tests/step1-args.test.js:80-86`, `step1-providers-config.test.js:20`, `step2-security.test.js:13,54`, `step2-tools.test.js:18`, `step3-backward-compat.test.js:15`, `step3-stream.test.js:94,102`, `step4-orchestrator.test.js:20,34,55,65,362,482`, `step4-reflection.test.js:21`, `step4-session.test.js:292`, `thought-signature.test.js:110`, `compactor.test.js:30`, `phase1-source-of-truth.test.js:127,201`, `phase2-getters.test.js:29,35` | temp-dir prefixes `termuxai-*` → `faycli-*`; stream fixture `.termuxai/config.json` → `.faycli/config.json` |
| `tests/e2e/e2e-piping.test.js:58`, `e2e-self-healing.test.js:38`, `e2e-session-resume.test.js:29` | temp-dir prefixes → `faycli-*` |
| `tests/step1-config-migrate.test.js` | already added in Task 3 |

- [ ] **Step 2: Update `phase2-getters.test.js:29` comment**

`// men-touch ~/.termuxai/config.json milik user.` → `~/.faycli/config.json`.

- [ ] **Step 3: Run full suite**

Run: `npm test 2>&1 | tail -30`
Expected: PASS (check for any residual `termuxai` assertions via `grep -rn termuxai tests/` — must be empty).

- [ ] **Step 4: Commit**

```bash
git add tests/
git commit -m "test: update expectations from termuxai to faycli"
```

---

## Task 9: Install script

**Files:**
- Modify: `install.sh:117,119-120,128-129,136`

- [ ] **Step 1: Edit directories block**

```bash
setup_directories() {
  log_step "Setting up faycli directories"

  FAYCLI_DIR="$HOME/.faycli"
  SESSIONS_DIR="$FAYCLI_DIR/sessions"

  mkdir -p "$FAYCLI_DIR"
  chmod 700 "$FAYCLI_DIR"

  mkdir -p "$SESSIONS_DIR"
  chmod 700 "$SESSIONS_DIR"

  log_success "Config directory: $FAYCLI_DIR"
  log_success "Sessions directory: $SESSIONS_DIR"
```

Line 136: `To allow termuxai to access /sdcard` → `To allow faycli to access /sdcard`.

- [ ] **Step 2: Verify binary install name**

Run: `grep -n "termuxai\|tai" install.sh`
Expected: any remaining `termuxai` only in the storage reminder text that was already replaced — grep should be clean except unrelated `tai` occurrences.

- [ ] **Step 3: Commit**

```bash
git add install.sh
git commit -m "chore(install): use ~/.faycli config dir"
```

---

## Task 10: `.gitignore`

**Files:**
- Modify: `.gitignore:12`

- [ ] **Step 1: Edit**

`.termuxai/` → `.faycli/`

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore .faycli config dir"
```

---

## Task 11: Docs — README, CHANGELOG, SECURITY

**Files:**
- Modify: `README.md` (lines 1,14,25,75,83,90,97,105,109-112 + any other `termuxai`), `CHANGELOG.md:34`, `SECURITY.md:5,24`, `docs/superpowers/plans/2026-09-01-unlimited-loop-compact.md:247,533`

- [ ] **Step 1: README**

Replace every `termuxai` → `faycli` and header `# Termux AI CLI (`termuxai`)` → `# FAY CLI (`faycli`)`. Note README line 25 references `tai model` binary — that stays (it's the historical binary alias, unchanged in this plan). Update line 14 "**Termux AI CLI (`termuxai`)**" → "**FAY CLI (`faycli`)**". Keep the Termux-platform framing (product still Termux-targeted); only the name changes.

- [ ] **Step 2: CHANGELOG + SECURITY**

CHANGELOG.md:34: `` termuxai config set locale id `` → `faycli config set locale id`.
SECURITY.md:5: `termuxai grants an LLM shell access` → `faycli grants an LLM shell access`; :24: `` `termuxai config set security.allowTermuxStorage true` `` → `` `faycli ...` ``.

- [ ] **Step 3: Old plan docs (cosmetic temp prefixes)**

`docs/superpowers/plans/2026-09-01-unlimited-loop-compact.md:247,533`: `termuxai-compact-test-` → `faycli-compact-test-`, `termuxai-unlimited-test-` → `faycli-unlimited-test-`.

- [ ] **Step 4: Verify + commit**

Run: `grep -rn "termuxai" README.md CHANGELOG.md SECURITY.md docs/ | grep -v specs/`
Expected: no output.
```bash
git add README.md CHANGELOG.md SECURITY.md docs/
git commit -m "docs: rename termuxai to faycli"
```

---

## Task 12: Scripts

**Files:**
- Modify: `scripts/benchmark.js:4,194,308`
- Modify: `scripts/test-e2e.js:4,128`

- [ ] **Step 1: Replace strings**

- benchmark.js:4 `Termux AI CLI (`termuxai`)` → `FAY CLI (`faycli`)`
- benchmark.js:194 `⚡ Termux AI CLI — Performance Benchmark` → `⚡ FAY CLI — Performance Benchmark`
- benchmark.js:308 `` — termuxai meets PRD performance targets. `` → `` — faycli meets PRD performance targets. ``
- test-e2e.js:4 → `FAY CLI (`faycli`) — E2E Test Runner`
- test-e2e.js:128 `🧪 Termux AI CLI — E2E Integration Test Suite` → `🧪 FAY CLI — E2E Integration Test Suite`

- [ ] **Step 2: Commit**

```bash
git add scripts/
git commit -m "chore(scripts): rename banners to FAY CLI"
```

---

## Task 13: Final verification

- [ ] **Step 1: Grep sweep**

Run: `grep -rn "termuxai\|Termux AI CLI\|termux-ai-cli" --include="*.js" --include="*.json" --include="*.md" --include="*.sh" --include="*.gitignore" . | grep -v node_modules | grep -v "\.claude/"`
Expected: no output (except intentional `T_AI_*` legacy env-var/`.t-ai` fallback strings in `manager.js` and `constants.js`, and historical `tai` binary mentions in README).

- [ ] **Step 2: Full test suite**

Run: `npm test 2>&1 | tail -30`
Expected: all pass.

- [ ] **Step 3: Help & version smoke**

Run: `node bin/tai.js --help 2>&1 | head -5`
Expected: shows `⚡ fay-cli v1.0.0` and USAGE `faycli`.

Run: `node bin/tai.js --version`
Expected: `⚡ fay-cli v1.0.0`.

- [ ] **Step 4: Migration smoke**

Run: `node -e "const fs=require('fs');const os=require('os');const path=require('path');const h=fs.mkdtempSync(path.join(os.tmpdir(),'faysmoke-'));fs.mkdirSync(path.join(h,'.termuxai'),{recursive:true});fs.writeFileSync(path.join(h,'.termuxai','config.json'),'{}');process.env.HOME=h;const m=new (require('./src/config/manager.js').ConfigManager)();console.log(m.getConfigDir());" 2>&1`
Expected: prints temp home + `.faycli`.

- [ ] **Step 5: Commit any stragglers**

```bash
git status --short
```
Then commit anything unexpected that survived the sweep.

---

## Self-Review

**Spec coverage:** spec sections map to tasks: 1→T1, 2→T1/T3/T4, 3→T3, 4→T5/T6/T7/T11/T12, 5→T8. Verification steps mirror spec's "Verification" list. `TERMUXAI_API_KEY`→`FAYCLI_API_KEY` (T1) extends the env-var rename consistently; `T_AI_API_KEY`/`T_AI_CONFIG_DIR`/`.t-ai` legacy fallbacks retained per existing backward-compat pattern.

**Type/name consistency:** `faycli` used for binary + `APP_NAME`; `fay-cli` for `APP_FULL_NAME` (help banner); `.faycli` for config dir. Tests reference `faycli (FAY CLI)` matching T7's system-prompt text. `fs.cpSync` requires Node ≥20 — engines field already `>=20.0.0`.

**No placeholders:** every string replacement listed with exact old→new text; every test file enumerated.
