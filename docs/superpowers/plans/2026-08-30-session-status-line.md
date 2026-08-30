# Session Status Line Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show cumulative API tokens, context-budget usage, and ReAct loop iterations in one dim status line above each REPL prompt.

**Architecture:** A new pure module (`src/agent/usage.js`) accumulates real API usage (already parsed by both LLM adapters) into `session.metadata.usage` — so totals persist via the existing session save and survive `resume`. The orchestrator feeds it and switches its budget check to a real-usage-anchored context number; the OpenAI adapter gets a small fix to actually surface streaming usage; `src/ui/box.js` renders the line; the REPL prints it after every turn.

**Tech Stack:** Node.js ESM (zero deps), `node:test` + `node:assert/strict`, Biome (pre-commit hook runs `npx biome check .` on the whole tree — new files must be LF).

**Spec:** `docs/superpowers/specs/2026-08-30-session-status-line-design.md`

**Repo state note:** another session has been committing to this working tree (branch `PERF-2-sliding-window-pruning` was checked out mid-brainstorming). Task 0 creates a feature branch from current HEAD; if any git step fails, surface it instead of forcing.

---

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `src/agent/usage.js` | Create | Pure usage logic: accumulator, context/budget math, compact formatting. No I/O, no ANSI. |
| `src/ui/box.js` | Modify | `renderStatusLine()` — the one dim ANSI line (joins usage.js numbers with box.js presentation). |
| `src/agent/orchestrator.js` | Modify | 3 touch points in `runTurn`: snapshot baseline, accumulate usage, budget check via `getContextTokens()`. |
| `src/llm/openai.js` | Modify | Streaming: parse `data.usage` chunks, send `stream_options.include_usage`, one silent 400-fallback retry without it. |
| `src/cli/repl.js` | Modify | Track last iteration count; print status line after every agent turn (success/error/abort). |
| `src/cli/slash-commands.js` | Modify | `/session` card gains real-usage rows. |
| `tests/usage.test.js` | Create | Unit tests for usage.js. |
| `tests/status-line.test.js` | Create | Unit tests for `renderStatusLine`. |
| `tests/session-status-repl.test.js` | Create | REPL wiring + `/session` rows tests. |
| `tests/step4-orchestrator.test.js` | Modify | Usage accumulation + budget-stop tests. |
| `tests/step3-openai-adapter.test.js` | Modify | Streaming usage + `stream_options` tests. |
| `CHANGELOG.md`, `README.md` | Modify | Docs. |

**Persistence/resume needs no task:** `Session.toJSON()` already serializes `metadata` verbatim, so `usage` rides the existing atomic save.

---

### Task 0: Branch setup

**Files:** none (git only)

- [ ] **Step 1: Create the feature branch from current HEAD**

```bash
cd "C:\xampp\htdocs\faydev\AI-Termux"
git status --short          # expect clean (or only unrelated WIP — do NOT commit others' files)
git checkout -b feat/session-status-line
```

Expected: `Switched to a new branch 'feat/session-status-line'`

---

### Task 1: `usage.js` — accumulator core

**Files:**
- Create: `src/agent/usage.js`
- Test: `tests/usage.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/usage.test.js`:

```js
/**
 * Unit Tests: Session Usage Accumulator, Context Budget & Compact Formatting
 * Feature: Session status line (tokens · context · loops)
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { Session } from '../src/agent/session.js';
import { accumulateUsage, createUsage, getUsage, markRequestStart } from '../src/agent/usage.js';

describe('Session Usage Accumulator', () => {
  test('createUsage returns the zeroed shape', () => {
    assert.deepEqual(createUsage(), {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      llmRequests: 0,
      lastPromptTokens: 0,
      estTokensAtLastRequest: 0,
      updatedAt: null,
    });
  });

  test('accumulateUsage maps the provider usage shape into session metadata', () => {
    const session = new Session({});
    accumulateUsage(session, {
      promptTokenCount: 1000,
      candidatesTokenCount: 50,
      totalTokenCount: 1050,
    });

    const usage = session.metadata.usage;
    assert.equal(usage.promptTokens, 1000);
    assert.equal(usage.completionTokens, 50);
    assert.equal(usage.totalTokens, 1050);
    assert.equal(usage.llmRequests, 1);
    assert.equal(usage.lastPromptTokens, 1000);
    assert.ok(usage.updatedAt);
  });

  test('accumulateUsage sums across repeated responses', () => {
    const session = new Session({});
    accumulateUsage(session, {
      promptTokenCount: 1000,
      candidatesTokenCount: 50,
      totalTokenCount: 1050,
    });
    accumulateUsage(session, {
      promptTokenCount: 2000,
      candidatesTokenCount: 100,
      totalTokenCount: 2100,
    });

    const usage = session.metadata.usage;
    assert.equal(usage.promptTokens, 3000);
    assert.equal(usage.completionTokens, 150);
    assert.equal(usage.totalTokens, 3150);
    assert.equal(usage.llmRequests, 2);
    assert.equal(usage.lastPromptTokens, 2000);
  });

  test('accumulateUsage is a no-op on null/undefined usage', () => {
    const session = new Session({});
    accumulateUsage(session, null);
    accumulateUsage(session, undefined);
    assert.equal(session.metadata.usage, undefined);
  });

  test('getUsage returns a zeroed object when session has no usage', () => {
    const session = new Session({});
    const usage = getUsage(session);
    assert.equal(usage.llmRequests, 0);
    assert.equal(usage.totalTokens, 0);
  });

  test('markRequestStart snapshots the estimator baseline', () => {
    const session = new Session({});
    session.addUserMessage('Hello there, this is a test message.');
    const snapshot = markRequestStart(session);
    assert.ok(snapshot > 0);
    assert.equal(session.metadata.usage.estTokensAtLastRequest, snapshot);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test tests/usage.test.js
```

Expected: FAIL — `Cannot find module` for `../src/agent/usage.js`.

- [ ] **Step 3: Write the implementation**

Create `src/agent/usage.js`:

```js
/**
 * Session LLM Usage Tracking
 * Accumulates real API token usage into session metadata and derives the
 * context-size / budget numbers shared by the orchestrator's budget check
 * and the REPL status line. Pure logic — no I/O, no ANSI.
 */

import { estimateSessionTokens } from './pruner.js';

/** Fallback context budget when no explicit maxContextTokens is configured. */
const FALLBACK_MAX_CONTEXT_TOKENS = 800000;

/** Fraction of the context budget where the ReAct loop force-stops. */
const BUDGET_STOP_RATIO = 0.85;

/**
 * Creates a zeroed usage accumulator object
 * @returns {object}
 */
export function createUsage() {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    llmRequests: 0,
    lastPromptTokens: 0,
    estTokensAtLastRequest: 0,
    updatedAt: null,
  };
}

/**
 * Ensures session.metadata.usage exists and returns it (mutates in place)
 * @param {object} session
 * @returns {object}
 */
function ensureUsage(session) {
  if (!session.metadata || typeof session.metadata !== 'object') {
    session.metadata = {};
  }
  if (!session.metadata.usage || typeof session.metadata.usage !== 'object') {
    session.metadata.usage = createUsage();
  }
  return session.metadata.usage;
}

/**
 * Reads the session usage accumulator without mutating (zeroed default)
 * @param {object} session
 * @returns {object}
 */
export function getUsage(session) {
  const usage = session?.metadata?.usage;
  return usage && typeof usage === 'object' ? usage : createUsage();
}

/**
 * Snapshots the estimator baseline right before an LLM request, so
 * getContextTokens() can anchor real prompt tokens against post-request drift.
 * @param {object} session
 * @returns {number} Baseline estimate
 */
export function markRequestStart(session) {
  const usage = ensureUsage(session);
  usage.estTokensAtLastRequest = estimateSessionTokens(session);
  return usage.estTokensAtLastRequest;
}

/**
 * Accumulates one LLM response's usage into session.metadata.usage.
 * Callers pass the adapter-normalized shape {promptTokenCount,
 * candidatesTokenCount, totalTokenCount}. Null usage (provider did not
 * report) is a no-op.
 * @param {object} session
 * @param {object|null} usage
 * @returns {object} The session (for chaining)
 */
export function accumulateUsage(session, usage) {
  if (!usage || typeof usage !== 'object') {
    return session;
  }
  const target = ensureUsage(session);
  const prompt = usage.promptTokenCount ?? 0;
  const completion = usage.candidatesTokenCount ?? 0;
  const total = usage.totalTokenCount ?? prompt + completion;

  target.promptTokens += prompt;
  target.completionTokens += completion;
  target.totalTokens += total;
  target.llmRequests += 1;
  target.lastPromptTokens = prompt;
  target.updatedAt = new Date().toISOString();
  return session;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test tests/usage.test.js
```

Expected: all `Session Usage Accumulator` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/usage.js tests/usage.test.js
git commit -m "feat(agent): session usage accumulator in metadata (status-line 1/5)"
```

---

### Task 2: `usage.js` — context tokens & budget limit

**Files:**
- Modify: `src/agent/usage.js`
- Test: `tests/usage.test.js`

- [ ] **Step 1: Write the failing tests**

First update the imports at the top of `tests/usage.test.js` — the usage.js import gains `contextBudgetLimit` and `getContextTokens`, and a pruner import is added for the estimator:

```js
import { estimateSessionTokens } from '../src/agent/pruner.js';
import { Session } from '../src/agent/session.js';
import {
  accumulateUsage,
  contextBudgetLimit,
  createUsage,
  getContextTokens,
  getUsage,
  markRequestStart,
} from '../src/agent/usage.js';
```

Then append to `tests/usage.test.js`:

```js
describe('Context Tokens & Budget', () => {
  test('getContextTokens falls back to the estimator without real usage', () => {
    const session = new Session({});
    session.addUserMessage('Hello there, this is a test message.');
    assert.equal(getContextTokens(session), estimateSessionTokens(session));
  });

  test('getContextTokens anchors on real usage plus drift since the request', () => {
    const session = new Session({});
    session.addUserMessage('First message content.');
    markRequestStart(session);
    // Real API reports 700k context tokens for the last request
    accumulateUsage(session, {
      promptTokenCount: 700000,
      candidatesTokenCount: 10,
      totalTokenCount: 700010,
    });
    // New messages arrive after that request (tool output, etc.)
    session.addFunctionResponseMessage('read_file', { content: 'x'.repeat(400) });

    const usage = session.metadata.usage;
    const expected = 700000 + (estimateSessionTokens(session) - usage.estTokensAtLastRequest);
    assert.equal(getContextTokens(session), expected);
    assert.ok(getContextTokens(session) >= 700000);
  });

  test('contextBudgetLimit takes 85% of the given limit', () => {
    assert.equal(contextBudgetLimit(1000000), 850000);
    assert.equal(contextBudgetLimit(800000), 680000);
  });

  test('contextBudgetLimit falls back to the 800k default on falsy input', () => {
    assert.equal(contextBudgetLimit(undefined), 680000);
    assert.equal(contextBudgetLimit(null), 680000);
    assert.equal(contextBudgetLimit(0), 680000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test tests/usage.test.js
```

Expected: file FAILS TO LOAD — `SyntaxError: The requested module '../src/agent/usage.js' does not provide an export named 'contextBudgetLimit'`.

- [ ] **Step 3: Write the implementation**

Append to `src/agent/usage.js`:

```js
/**
 * Estimates the context size of the NEXT request: the real prompt-token
 * count of the last request (ground truth) plus the estimated drift of
 * messages appended since it. Falls back to the pure estimator when no
 * real usage has been recorded. Never returns less than the real anchor.
 * @param {object} session
 * @returns {number}
 */
export function getContextTokens(session) {
  const est = estimateSessionTokens(session);
  const usage = getUsage(session);
  if (!usage.lastPromptTokens) {
    return est;
  }
  const delta = Math.max(0, est - usage.estTokensAtLastRequest);
  return Math.max(usage.lastPromptTokens, usage.lastPromptTokens + delta);
}

/**
 * Single source for the budget force-stop limit: 85% of the max context
 * tokens, with the 800k fallback the orchestrator has always used for a
 * falsy limit. Both the orchestrator check and the REPL display call this.
 * @param {number|undefined} maxContextTokens
 * @returns {number}
 */
export function contextBudgetLimit(maxContextTokens) {
  return Math.floor((maxContextTokens || FALLBACK_MAX_CONTEXT_TOKENS) * BUDGET_STOP_RATIO);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test tests/usage.test.js
```

Expected: PASS (all blocks).

- [ ] **Step 5: Commit**

```bash
git add src/agent/usage.js tests/usage.test.js
git commit -m "feat(agent): real-usage-anchored context tokens and shared budget limit (status-line 2/5)"
```

---

### Task 3: `usage.js` — compact token formatting

**Files:**
- Modify: `src/agent/usage.js`
- Test: `tests/usage.test.js`

- [ ] **Step 1: Write the failing tests**

First add `formatCompactTokens` to the usage.js import at the top of `tests/usage.test.js`:

```js
import {
  accumulateUsage,
  contextBudgetLimit,
  createUsage,
  formatCompactTokens,
  getContextTokens,
  getUsage,
  markRequestStart,
} from '../src/agent/usage.js';
```

Then append to `tests/usage.test.js`:

```js
describe('formatCompactTokens', () => {
  test('below 1000 stays an integer string', () => {
    assert.equal(formatCompactTokens(0), '0');
    assert.equal(formatCompactTokens(950), '950');
    assert.equal(formatCompactTokens(999), '999');
  });

  test('thousands use k with one decimal, trailing .0 dropped', () => {
    assert.equal(formatCompactTokens(1000), '1k');
    assert.equal(formatCompactTokens(23400), '23.4k');
    assert.equal(formatCompactTokens(999949), '999.9k');
  });

  test('millions use M with one decimal, trailing .0 dropped', () => {
    assert.equal(formatCompactTokens(1000000), '1M');
    assert.equal(formatCompactTokens(1234567), '1.2M');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test tests/usage.test.js
```

Expected: file FAILS TO LOAD — `SyntaxError: The requested module '../src/agent/usage.js' does not provide an export named 'formatCompactTokens'`.

- [ ] **Step 3: Write the implementation**

Append to `src/agent/usage.js`:

```js
/**
 * Formats a token count compactly: <1000 → "950"; <1M → one decimal in k
 * with a trailing ".0" dropped ("23.4k", "1k"); ≥1M → same in M ("1.2M").
 * Rounds half-up at the one decimal.
 * @param {number} n
 * @returns {string}
 */
export function formatCompactTokens(n) {
  const num = Number(n) || 0;
  if (num < 1000) {
    return String(Math.floor(num));
  }
  if (num < 1000000) {
    const k = Math.round((num / 1000) * 10) / 10;
    return `${k % 1 === 0 ? String(k) : k.toFixed(1)}k`;
  }
  const m = Math.round((num / 1000000) * 10) / 10;
  return `${m % 1 === 0 ? String(m) : m.toFixed(1)}M`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test tests/usage.test.js
```

Expected: PASS (all blocks).

- [ ] **Step 5: Commit**

```bash
git add src/agent/usage.js tests/usage.test.js
git commit -m "feat(agent): compact token formatting helper (status-line 3/5)"
```

---

### Task 4: Orchestrator integration

**Files:**
- Modify: `src/agent/orchestrator.js`
- Test: `tests/step4-orchestrator.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/step4-orchestrator.test.js` (new top-level describe at end of file — it needs its own `beforeEach`/`afterEach`):

```js
describe('Step 4: Orchestrator Usage Accumulation', () => {
  let tempDir;
  let sessionManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'termuxai-usage-test-'));
    sessionManager = new SessionManager({ sessionsDir: tempDir });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test('accumulates real usage across iterations into session metadata', async () => {
    fs.writeFileSync(path.join(tempDir, 'hello.txt'), 'Content from file!', 'utf8');

    let callCount = 0;
    const mockGemini = {
      getModel: () => 'gemini-2.5-flash',
      generateStream: async () => {
        callCount++;
        if (callCount === 1) {
          return {
            text: 'Membaca file.',
            functionCalls: [{ name: 'read_file', args: { filePath: 'hello.txt' } }],
            finishReason: 'STOP',
            usage: { promptTokenCount: 1000, candidatesTokenCount: 50, totalTokenCount: 1050 },
          };
        }
        return {
          text: 'Selesai.',
          functionCalls: [],
          finishReason: 'STOP',
          usage: { promptTokenCount: 2000, candidatesTokenCount: 100, totalTokenCount: 2100 },
        };
      },
    };

    const session = sessionManager.createSession({ workingDir: tempDir });
    const orchestrator = new AgentOrchestrator({
      llmClient: mockGemini,
      session,
      workingDir: tempDir,
      autoApprove: true,
    });

    await orchestrator.runTurn('Baca file hello.txt', {});

    const usage = session.metadata.usage;
    assert.equal(usage.llmRequests, 2);
    assert.equal(usage.promptTokens, 3000);
    assert.equal(usage.completionTokens, 150);
    assert.equal(usage.totalTokens, 3150);
    assert.equal(usage.lastPromptTokens, 2000);
    assert.ok(usage.estTokensAtLastRequest > 0);
    assert.ok(usage.updatedAt);
  });

  test('budget check stops the loop when real context exceeds the limit', async () => {
    let callCount = 0;
    const mockGemini = {
      getModel: () => 'gemini-2.5-flash',
      generateStream: async () => {
        callCount++;
        return {
          text: 'loop attempt',
          functionCalls: [{ name: 'read_file', args: { filePath: 'missing.txt' } }],
          finishReason: 'STOP',
          usage: { promptTokenCount: 700000, candidatesTokenCount: 10, totalTokenCount: 700010 },
        };
      },
    };

    const session = sessionManager.createSession({ workingDir: tempDir });
    const orchestrator = new AgentOrchestrator({
      llmClient: mockGemini,
      session,
      workingDir: tempDir,
      autoApprove: true,
    });

    const result = await orchestrator.runTurn('keep going', {});

    // Iteration 1 passes the estimator check (no usage yet), records 700k real
    // usage; iteration 2's getContextTokens() exceeds the 680k budget → break.
    assert.equal(callCount, 1);
    assert.equal(result.iterations, 2);
    assert.equal(result.loopLimitReached, false);
    assert.equal(result.success, true);
  });

  test('no usage reported → metadata.usage exists but stays zeroed on totals', async () => {
    const mockGemini = {
      getModel: () => 'gemini-2.5-flash',
      generateStream: async () => ({
        text: 'Halo!',
        functionCalls: [],
        finishReason: 'STOP',
      }),
    };

    const session = sessionManager.createSession({ workingDir: tempDir });
    const orchestrator = new AgentOrchestrator({
      llmClient: mockGemini,
      session,
      workingDir: tempDir,
    });

    await orchestrator.runTurn('Halo', {});

    const usage = session.metadata.usage;
    assert.ok(usage); // markRequestStart created the accumulator
    assert.equal(usage.llmRequests, 0);
    assert.equal(usage.totalTokens, 0);
    assert.ok(usage.estTokensAtLastRequest > 0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test tests/step4-orchestrator.test.js
```

Expected: the three new tests FAIL (usage stays `undefined`; budget test's `callCount` is 30, `loopLimitReached` true).

- [ ] **Step 3: Write the implementation**

In `src/agent/orchestrator.js`, add the import after the pruner import (line 12):

```js
import { accumulateUsage, contextBudgetLimit, getContextTokens, markRequestStart } from './usage.js';
```

Replace the budget check at lines 166-175:

```js
      // Step 0: Token Budget Check — stop before context overflows
      const currentTokens = estimateSessionTokens(this.session);
      const budgetLimit = Math.floor((this.maxContextTokens || 800000) * 0.85);
```

with:

```js
      // Step 0: Token Budget Check — stop before context overflows.
      // Real API usage anchors the estimate when available (see usage.js).
      const currentTokens = getContextTokens(this.session);
      const budgetLimit = contextBudgetLimit(this.maxContextTokens);
```

Insert a snapshot immediately before the Step 2 `try {` block (after the pruning lines ending `const prunedContents = pruneMessages(...)` block, ~line 183):

```js
      // Step 1.5: Snapshot the estimator baseline for real-usage anchoring
      markRequestStart(this.session);
```

Insert the accumulation immediately after the Step 2 try/catch closes (before `let { text, functionCalls } = streamResult;`, ~line 203):

```js
      // Step 2.5: Accumulate real API usage into session metadata
      accumulateUsage(this.session, streamResult.usage);
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test tests/step4-orchestrator.test.js
```

Expected: PASS — new tests AND all pre-existing orchestrator tests (the fallback path is numerically identical to the old check).

- [ ] **Step 5: Commit**

```bash
git add src/agent/orchestrator.js tests/step4-orchestrator.test.js
git commit -m "feat(agent): orchestrator feeds usage accumulator and budget check uses real context (status-line 4/5)"
```

---

### Task 5: `renderStatusLine` in box.js

**Files:**
- Modify: `src/ui/box.js`
- Test: `tests/status-line.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/status-line.test.js`:

```js
/**
 * Unit Tests: REPL Session Status Line Renderer
 * Feature: Session status line (tokens · context · loops)
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { stripAnsi } from '../src/utils/ansi.js';
import { renderStatusLine } from '../src/ui/box.js';
import { accumulateUsage, createUsage } from '../src/agent/usage.js';
import { Session } from '../src/agent/session.js';

function realUsage({ prompt, completion, total }) {
  const session = new Session({});
  accumulateUsage(session, { promptTokenCount: prompt, candidatesTokenCount: completion, totalTokenCount: total });
  return session.metadata.usage;
}

describe('renderStatusLine', () => {
  test('shows real usage without tilde, ctx percent and loop counts', () => {
    const line = renderStatusLine({
      usage: realUsage({ prompt: 5000, completion: 200, total: 5200 }),
      contextTokens: 81600,
      contextBudget: 680000,
      iterations: 7,
      maxIterations: 30,
    });
    assert.equal(stripAnsi(line), '─ 5.2k tok │ ctx 12% │ loop 7/30 ─');
  });

  test('tilde prefix and ~0 tok when the provider reports no usage', () => {
    const line = renderStatusLine({
      usage: createUsage(),
      contextTokens: 0,
      contextBudget: 680000,
      iterations: 1,
      maxIterations: 30,
    });
    assert.equal(stripAnsi(line), '─ ~0 tok │ ctx 0% │ loop 1/30 ─');
  });

  test('loop segment omitted before any turn ran', () => {
    const line = renderStatusLine({
      usage: createUsage(),
      contextTokens: 0,
      contextBudget: 680000,
      iterations: 0,
      maxIterations: 30,
    });
    assert.equal(stripAnsi(line), '─ ~0 tok │ ctx 0% ─');
  });

  test('large values use M formatting and over-budget ctx exceeds 100%', () => {
    const line = renderStatusLine({
      usage: realUsage({ prompt: 1200000, completion: 45000, total: 1245000 }),
      contextTokens: 710000,
      contextBudget: 680000,
      iterations: 12,
      maxIterations: 30,
    });
    assert.equal(stripAnsi(line), '─ 1.2M tok │ ctx 104% │ loop 12/30 ─');
  });

  test('whole line is dimmed', () => {
    const line = renderStatusLine({
      usage: createUsage(),
      contextTokens: 0,
      contextBudget: 680000,
      iterations: 0,
      maxIterations: 0,
    });
    assert.ok(line.startsWith('\x1b[2m'));
    assert.ok(line.endsWith('\x1b[22m'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test tests/status-line.test.js
```

Expected: FAIL — `renderStatusLine is not a function` (undefined export).

- [ ] **Step 3: Write the implementation**

In `src/ui/box.js`, add the import at the top (after the ansi import):

```js
import { formatCompactTokens } from '../agent/usage.js';
```

Append at the end of the file:

```js
/**
 * Renders the one-line session status shown above each REPL prompt after
 * every agent turn: tokens billed, context budget usage, loop iterations.
 *
 * @param {object} [options={}]
 * @param {object} [options.usage] - session.metadata.usage accumulator (see agent/usage.js)
 * @param {number} [options.contextTokens=0] - context size of the next request
 * @param {number} [options.contextBudget=0] - budget force-stop limit (85%)
 * @param {number} [options.iterations=0] - iterations used in the last turn
 * @param {number} [options.maxIterations=0] - ReAct loop cap
 * @returns {string} Single dim status line
 */
export function renderStatusLine(options = {}) {
  const usage = options.usage || {};
  const contextTokens = options.contextTokens || 0;
  const contextBudget = options.contextBudget || 0;
  const iterations = options.iterations || 0;
  const maxIterations = options.maxIterations || 0;

  // No usage-bearing response so far → the token figure is estimator-derived
  const estimated = !usage.llmRequests;
  const tok = `${estimated ? '~' : ''}${formatCompactTokens(usage.totalTokens || 0)} tok`;
  const pct = contextBudget > 0 ? Math.floor((contextTokens / contextBudget) * 100) : 0;

  const segments = [tok, `ctx ${pct}%`];
  if (iterations > 0 && maxIterations > 0) {
    segments.push(`loop ${iterations}/${maxIterations}`);
  }

  return ansi.dim(`─ ${segments.join(' │ ')} ─`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test tests/status-line.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/box.js tests/status-line.test.js
git commit -m "feat(ui): renderStatusLine for the REPL prompt status (status-line renderer)"
```

---

### Task 6: OpenAI adapter — streaming usage

**Files:**
- Modify: `src/llm/openai.js` (`generateStream` ~line 168-199, `_parseOpenAISSE` ~line 201-319)
- Test: `tests/step3-openai-adapter.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/step3-openai-adapter.test.js` (new top-level describe at end of file):

```js
describe('Step 3: OpenAI Adapter Streaming Usage', () => {
  function createReadableStream(items) {
    return new ReadableStream({
      start(controller) {
        for (const item of items) controller.enqueue(new TextEncoder().encode(item));
        controller.close();
      },
    });
  }

  test('usage parsed from the terminal empty-choices chunk', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
      'data: [DONE]\n\n',
    ];
    const client = new OpenAIClient({ apiKey: 'k', model: 'gpt-4o', fetch: makeFetcher(chunks) });
    const result = await client.generateStream({
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
    });
    assert.deepEqual(result.usage, {
      promptTokenCount: 10,
      candidatesTokenCount: 5,
      totalTokenCount: 15,
    });
  });

  test('request body includes stream_options.include_usage', async () => {
    const bodies = [];
    const fetchMock = async (_url, init) => {
      bodies.push(JSON.parse(init?.body || '{}'));
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        body: createReadableStream(['data: [DONE]\n\n']),
      };
    };
    const client = new OpenAIClient({ apiKey: 'k', model: 'gpt-4o', fetch: fetchMock });
    await client.generateStream({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] });
    assert.deepEqual(bodies[0].stream_options, { include_usage: true });
  });

  test('400 with stream_options retries once without it and succeeds', async () => {
    const bodies = [];
    let call = 0;
    const fetchMock = async (_url, init) => {
      call++;
      bodies.push(JSON.parse(init?.body || '{}'));
      if (call === 1) {
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: { message: 'stream_options is not supported' } }),
          body: createReadableStream([]),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        body: createReadableStream([
          'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      };
    };
    const client = new OpenAIClient({ apiKey: 'k', model: 'gpt-4o', fetch: fetchMock });
    const result = await client.generateStream({
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
    });
    assert.equal(call, 2);
    assert.deepEqual(bodies[0].stream_options, { include_usage: true });
    assert.equal(bodies[1].stream_options, undefined);
    assert.equal(result.text, 'ok');
  });

  test('400 twice surfaces the ORIGINAL error and does not loop', async () => {
    let call = 0;
    const fetchMock = async () => {
      call++;
      return {
        ok: false,
        status: 400,
        json: async () => ({ error: { message: `bad ${call}` } }),
        body: createReadableStream([]),
      };
    };
    const client = new OpenAIClient({ apiKey: 'k', model: 'gpt-4o', fetch: fetchMock });
    await assert.rejects(
      () => client.generateStream({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }),
      /OpenAI API Error \(400\): bad 1/,
    );
    assert.equal(call, 2);
  });
});
```

Note: `makeFetcher` is the existing helper at the top of this file — the first test reuses it; the other three use local `fetchMock`s.

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test tests/step3-openai-adapter.test.js
```

Expected: usage test FAILS (`result.usage` is `null`); `stream_options` test FAILS (`undefined`); first 400 test FAILS (call stays 1, rejects with the 400 error); the "twice" test may already PASS (400 is non-retryable in `retry.js` — it locks that invariant).

- [ ] **Step 3: Write the implementation**

In `src/llm/openai.js`:

**(a)** In `generateStream`, after `payload.stream = true;` (line 176):

```js
    payload.stream = true;
    // Ask compatible servers for a final usage chunk (OpenAI requires this
    // field). Servers that reject unknown body fields get one silent retry
    // without it — see the 400 fallback below.
    payload.stream_options = { include_usage: true };
```

**(b)** Replace the request closure (lines 181-198) with:

```js
    return await this._requestWithRetry(
      async () => {
        let response = await this.fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: parentSignal,
        });

        // Some OpenAI-compatible servers reject unknown body fields with 400.
        // Retry once without stream_options; a 400 generates nothing, so
        // re-sending has no billing or side-effect risk.
        if (!response.ok && response.status === 400 && payload.stream_options) {
          const original = response;
          delete payload.stream_options;
          response = await this.fetch(endpoint, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
            signal: parentSignal,
          });
          if (!response.ok) {
            await this._handleErrorResponse(original);
          }
        }

        if (!response.ok) await this._handleErrorResponse(response);

        return await this._parseOpenAISSE(response.body, options, parentSignal);
      },
      { signal: parentSignal, logger: this.logger, locale: this.locale },
    );
```

**(c)** In `_parseOpenAISSE`, add a `usage` accumulator next to the other state (~line 204):

```js
    const tokens = [];
    const functionCalls = [];
    let finishReason = null;
    let usage = null;
```

**(d)** Inside `onChunk`, immediately after the JSON parse succeeds (before the empty-`choices` early return at ~line 244):

```js
      // Usage arrives on the terminal empty-choices chunk (OpenAI with
      // stream_options) or sometimes on the last regular chunk.
      if (data.usage) {
        usage = {
          promptTokenCount: data.usage.prompt_tokens ?? 0,
          candidatesTokenCount: data.usage.completion_tokens ?? 0,
          totalTokenCount: data.usage.total_tokens ?? 0,
        };
      }
```

**(e)** Change the final return (~line 312-318) from `usage: null,` to:

```js
    return {
      text: tokens.join(''),
      functionCalls,
      finishReason,
      usage,
      raw: null,
    };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test tests/step3-openai-adapter.test.js tests/step3-stream.test.js
```

Expected: PASS — new tests and all pre-existing adapter/stream tests.

- [ ] **Step 5: Commit**

```bash
git add src/llm/openai.js tests/step3-openai-adapter.test.js
git commit -m "feat(llm): surface streaming usage from OpenAI-compatible adapters (status-line 5/5)"
```

---

### Task 7: REPL wiring

**Files:**
- Modify: `src/cli/repl.js`
- Test: `tests/session-status-repl.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/session-status-repl.test.js`:

```js
/**
 * Unit Tests: REPL Session Status Line Wiring & /session Usage Rows
 * Feature: Session status line (tokens · context · loops)
 */

import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { describe, test } from 'node:test';

import { accumulateUsage } from '../src/agent/usage.js';
import { Session } from '../src/agent/session.js';
import { startRepl } from '../src/cli/repl.js';
import { executeSlashCommand } from '../src/cli/slash-commands.js';

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };
const stubConfigMgr = { get: () => undefined };

function createIO() {
  const input = new PassThrough();
  const output = new PassThrough();
  let text = '';
  output.on('data', (chunk) => {
    text += chunk.toString();
  });
  return { input, output, getText: () => text };
}

function createFakeOrchestrator(session, behavior = {}) {
  return {
    provider: 'gemini',
    workingDir: '/tmp/fake',
    maxIterations: 30,
    maxContextTokens: undefined,
    llmClient: { getModel: () => 'gemini-2.5-flash' },
    getSession: () => session,
    async runTurn(_prompt, opts = {}) {
      opts.onIterationStart?.(1);
      if (behavior.usage) {
        accumulateUsage(session, behavior.usage);
      }
      if (behavior.throw) {
        throw new Error(behavior.throw);
      }
      return { success: true, text: 'fake reply', iterations: 1, toolCalls: [], loopLimitReached: false, session };
    },
  };
}

describe('REPL Session Status Line', () => {
  test('prints the status line above the next prompt after a turn', async () => {
    const session = new Session({});
    const io = createIO();
    const orchestrator = createFakeOrchestrator(session, {
      usage: { promptTokenCount: 5000, candidatesTokenCount: 200, totalTokenCount: 5200 },
    });

    const replDone = startRepl({
      orchestrator,
      configMgr: stubConfigMgr,
      input: io.input,
      output: io.output,
      logger: silentLogger,
    });
    io.input.write('hello\n');
    io.input.write('/exit\n');
    await replDone;

    const text = io.getText();
    // Real usage → no tilde; ctx 0% (5.2k of 680k); loop 1/30 from onIterationStart
    assert.ok(text.includes('─ 5.2k tok │ ctx 0% │ loop 1/30 ─'), `status line missing in:\n${text}`);
  });

  test('prints an estimated (~) line when the turn errors', async () => {
    const session = new Session({});
    const io = createIO();
    const orchestrator = createFakeOrchestrator(session, { throw: 'boom' });

    const replDone = startRepl({
      orchestrator,
      configMgr: stubConfigMgr,
      input: io.input,
      output: io.output,
      logger: silentLogger,
    });
    io.input.write('hello\n');
    io.input.write('/exit\n');
    await replDone;

    assert.ok(io.getText().includes('~0 tok'), 'expected ~0 tok status line after error');
  });

  test('prints no status line when no agent turn runs', async () => {
    const session = new Session({});
    const io = createIO();
    const orchestrator = createFakeOrchestrator(session);

    const replDone = startRepl({
      orchestrator,
      configMgr: stubConfigMgr,
      input: io.input,
      output: io.output,
      logger: silentLogger,
    });
    io.input.write('/exit\n');
    await replDone;

    assert.ok(!io.getText().includes('│ ctx'), 'status line must not appear without an agent turn');
  });
});

describe('/session usage rows', () => {
  test('card shows API usage rows', async () => {
    const session = new Session({});
    accumulateUsage(session, { promptTokenCount: 5000, candidatesTokenCount: 200, totalTokenCount: 5200 });
    const orchestrator = { session, llmClient: { getModel: () => 'gemini-2.5-flash' } };

    const io = createIO();
    await executeSlashCommand('/session', {
      orchestrator,
      configMgr: stubConfigMgr,
      stream: io.output,
    });

    const text = io.getText();
    assert.ok(text.includes('API Requests'), `missing API Requests row:\n${text}`);
    assert.ok(text.includes('API Prompt Tokens'), `missing API Prompt Tokens row:\n${text}`);
    assert.ok(text.includes('API Completion Tokens'), `missing API Completion Tokens row:\n${text}`);
    assert.ok(text.includes('API Total Tokens'), `missing API Total Tokens row:\n${text}`);
  });
});
```

Note on abort coverage: the abort path shares the exact same `printStatusLine()` call site as the error path (both fall through the same `try/catch/finally`), and simulating SIGINT requires a TTY-mode readline that makes these tests timing-flaky — so it is intentionally covered by the error test + shared call site rather than a dedicated SIGINT simulation.

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test tests/session-status-repl.test.js
```

Expected: the two status-line tests FAIL (no such line in output); the no-turn test PASSES already (locks the invariant); the `/session` test FAILS (rows missing).

- [ ] **Step 3: Write the implementation**

In `src/cli/repl.js`:

**(a)** Extend the box import (line 11) and add the usage import (after the logger import, line 15):

```js
import { renderBanner, renderStatusLine } from '../ui/box.js';
```

```js
import { contextBudgetLimit, getContextTokens, getUsage } from '../agent/usage.js';
```

**(b)** Add state next to `let isBusy = false;` (line 81):

```js
  let isBusy = false;
  let lastIterations = 0;
```

**(c)** Add the helper after the `askQuestion` helper (after line 121):

```js
  // Prints the one-line session status (tokens · context · loops) that the
  // user sees above every new prompt. Reads fresh session state so it is
  // correct on success, error, and abort paths alike.
  const printStatusLine = () => {
    const sess = orchestrator.getSession();
    output.write(
      `\n${renderStatusLine({
        usage: getUsage(sess),
        contextTokens: getContextTokens(sess),
        contextBudget: contextBudgetLimit(orchestrator.maxContextTokens),
        iterations: lastIterations,
        maxIterations: orchestrator.maxIterations,
      })}\n`,
    );
  };
```

**(d)** Record the iteration count in the existing callback (line 175):

```js
        onIterationStart: (iter) => {
          lastIterations = iter;
          if (iter > 1) {
            hasStreamedToken = false;
            spinner.start(t('thinkingTurn', { turn: iter }));
          }
        },
```

**(e)** Call it after the turn's `try/catch/finally` block closes (after line 240, still inside the `while` loop, as the last statement of the agent-turn branch):

```js
      printStatusLine();
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test tests/session-status-repl.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/repl.js tests/session-status-repl.test.js
git commit -m "feat(repl): print session status line above each prompt (status-line display)"
```

---

### Task 8: `/session` card rows

**Files:**
- Modify: `src/cli/slash-commands.js:448-469`
- Test: `tests/session-status-repl.test.js` (already written in Task 7 — the failing `/session` test)

- [ ] **Step 1: Confirm the failing test**

```bash
node --test tests/session-status-repl.test.js
```

Expected: `/session usage rows > card shows API usage rows` FAILS.

- [ ] **Step 2: Write the implementation**

In `src/cli/slash-commands.js`, add the import (after the pruner import at line 6):

```js
import { getUsage } from '../agent/usage.js';
```

Replace the `case 'session':` body (lines 448-469) with:

```js
    case 'session': {
      if (!orchestrator?.session) {
        stream.write(`\n${ansi.yellow('⚠')} No active session context found.\n\n`);
        return { handled: true, action: 'session_info', error: true };
      }

      const sess = orchestrator.session;
      const msgs = sess.getMessages ? sess.getMessages() : [];
      const tokenEst = estimateSessionTokens ? estimateSessionTokens(sess) : 0;
      const usage = getUsage(sess);

      const card = renderStatusCard('Active Session Details', {
        'Session ID': sess.id || 'N/A',
        Model: orchestrator.llmClient?.getModel() || sess.model || 'N/A',
        'Working Dir': sess.workingDir || process.cwd(),
        'Message Turns': msgs.length,
        'Est. Tokens': `${tokenEst.toLocaleString()} tokens`,
        'API Requests': usage.llmRequests,
        'API Prompt Tokens': usage.promptTokens.toLocaleString(),
        'API Completion Tokens': usage.completionTokens.toLocaleString(),
        'API Total Tokens': usage.totalTokens.toLocaleString(),
        'Created At': sess.createdAt ? new Date(sess.createdAt).toLocaleString() : 'N/A',
      });

      stream.write(`\n${card}\n\n`);
      return { handled: true, action: 'session_info' };
    }
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
node --test tests/session-status-repl.test.js tests/step5-slash-model-crud.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/cli/slash-commands.js tests/session-status-repl.test.js
git commit -m "feat(cli): /session card shows real API usage rows"
```

---

### Task 9: Docs + full verification

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `README.md`

- [ ] **Step 1: CHANGELOG entry**

In `CHANGELOG.md`, under `## [Unreleased]` → `### Added`, append:

```markdown
- Session status line above each REPL prompt (`─ 23.4k tok │ ctx 12% │ loop 7/30 ─`): real API usage accumulated into `session.metadata.usage` via the new pure module `src/agent/usage.js` (estimator fallback with `~` prefix), OpenAI-compatible streaming usage parsing (`stream_options.include_usage` with one 400-fallback retry), and the ReAct budget check switched to the real-usage-anchored `getContextTokens()` (FEATURE-01).
```

- [ ] **Step 2: README mention**

In `README.md`, in `## 📖 Usage Modes` → `### 1. Interactive REPL Mode`, insert directly **before** the `#### Slash Commands (inside REPL)` heading:

````markdown
#### Session Status Line

After every agent turn, a one-line usage summary appears above the next prompt:

```
─ 23.4k tok │ ctx 12% │ loop 7/30 ─
```

- **tok** — cumulative API tokens billed this session (`~` prefix = estimate, shown when the provider does not report usage)
- **ctx** — context size vs the 85% budget where the ReAct loop force-stops
- **loop** — ReAct iterations used in the last turn vs the cap (default 30)

````

- [ ] **Step 3: Full suite + lint**

```bash
npm test
npm run lint
```

Expected: all tests PASS (the suite was 431 passing before this feature; everything green), lint clean (only the pre-existing `biome.json` deprecation info is acceptable).

- [ ] **Step 4: Manual smoke check (optional but recommended)**

```bash
node bin/termuxai.js
```

Send a message, confirm the dim status line appears above the next prompt with real token counts (Gemini reports usage natively).

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md README.md
git commit -m "docs: session status line in CHANGELOG and README (FEATURE-01)"
```

---

## Self-Review (done at plan-writing time)

1. **Spec coverage:** usage.js accumulator (Tasks 1-3) · orchestrator 3 touch points + budget switch (Task 4) · OpenAI streaming fix + stream_options + 400 fallback (Task 6) · renderStatusLine (Task 5) · REPL wiring incl. abort/error paths (Task 7) · /session rows (Task 8) · docs (Task 9). Resume/persistence requires no code (metadata already serialized). `~` prefix, non-localized abbreviations, dim single line, no glyph, loop omitted before first turn — all in Task 5.
2. **Placeholders:** none — every step has complete code or exact commands.
3. **Type consistency:** `createUsage` / `getUsage` / `accumulateUsage` / `markRequestStart` / `getContextTokens` / `contextBudgetLimit` / `formatCompactTokens` / `renderStatusLine` are named identically across all tasks; the usage object shape matches the spec (`promptTokens`, `completionTokens`, `totalTokens`, `llmRequests`, `lastPromptTokens`, `estTokensAtLastRequest`, `updatedAt`).
4. **ESM load-order fix applied during review:** the initial draft had `tests/usage.test.js` import `getContextTokens`/`formatCompactTokens`/`contextBudgetLimit` already in Task 1 — a load-time `SyntaxError` under ESM that would have made Task 1's green step impossible. Imports now grow per task (Task 1: accumulator functions only; Task 2 adds the context pair + estimator; Task 3 adds `formatCompactTokens`), and each task's "expected fail" states the actual `SyntaxError` wording.
