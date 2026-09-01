# Unlimited ReAct Loop with LLM Auto-Compact — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the 30-iteration cap from the ReAct loop; when context hits 92% of budget, compact it with an LLM summary (mechanical digest fallback) and keep looping. The only limits are: model final answer, user abort, API error, reflection stop, or an explicit `--max-iterations`.

**Architecture:** New `src/agent/compactor.js` owns all compaction (LLM summary → digest fallback → noop, with raw-head archive to `<id>.archive.jsonl`). `orchestrator.js` swaps its budget `break` for `await compactSession(...) + continue`, and defaults `maxIterations` to `Infinity`. `pruner.js` gains oversized-tool-result truncation as the per-request safety net. REPL gets `/compact`; `renderStatusLine` shows `loop N/∞`.

**Tech Stack:** Node ≥20, ESM, zero runtime deps, `node --test` + `node:assert/strict`, Biome lint.

**Spec:** `docs/superpowers/specs/2026-09-01-unlimited-loop-compact-design.md`

**Test command for every "run tests" step:** `node --test tests/<file>.test.js` from repo root. Expected output ends with `# pass N` / `# fail 0`.

---

### Task 1: usage.js — compact ratios

**Files:**
- Modify: `src/agent/usage.js` (constants at top, new export after `contextBudgetLimit`)
- Test: `tests/usage.test.js` (extend existing file)

- [ ] **Step 1: Write the failing test** — append to `tests/usage.test.js` (match its existing import style; add `compactTargetLimit` to the import from `../src/agent/usage.js`):

```js
describe('compact ratios', () => {
  test('trigger is 92% of budget, target is 60%, target < trigger', () => {
    assert.equal(contextBudgetLimit(1000000), 920000);
    assert.equal(compactTargetLimit(1000000), 600000);
    assert.ok(compactTargetLimit(1000000) < contextBudgetLimit(1000000));
  });

  test('compactTargetLimit uses the same 800k fallback as contextBudgetLimit', () => {
    assert.equal(compactTargetLimit(undefined), Math.floor(800000 * 0.6));
    assert.equal(compactTargetLimit(null), Math.floor(800000 * 0.6));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/usage.test.js`
Expected: FAIL — `compactTargetLimit` is not exported (SyntaxError on import). Also the old 0.85 assertion in the existing budget test (if any asserts 850000) will now fail — update it to 920000.

- [ ] **Step 3: Write minimal implementation** — in `src/agent/usage.js`, change the constant and add the new one:

```js
/** Fraction of the context budget where auto-compaction triggers. */
const BUDGET_STOP_RATIO = 0.92;

/** Fraction of the context budget that compaction aims to return to. */
const COMPACT_TARGET_RATIO = 0.6;
```

Add after `contextBudgetLimit`:

```js
/**
 * Token level compaction aims to reach after replacing old turns with a
 * summary. Kept well under contextBudgetLimit() so the next large tool
 * result still fits before the following iteration's trigger check.
 * @param {number|null|undefined} maxContextTokens
 * @returns {number}
 */
export function compactTargetLimit(maxContextTokens) {
  return Math.floor((maxContextTokens || FALLBACK_MAX_CONTEXT_TOKENS) * COMPACT_TARGET_RATIO);
}
```

Update the `contextBudgetLimit` JSDoc first line from "budget force-stop limit: 85%" to "compact trigger: 92%".

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/usage.test.js`
Expected: PASS (all, including any pre-existing tests updated to 92%).

- [ ] **Step 5: Commit**

```bash
git add src/agent/usage.js tests/usage.test.js
git commit -m "feat(usage): compact trigger 92%, add 60% target limit"
```

---

### Task 2: pruner.js — truncate oversized tool results

**Files:**
- Modify: `src/agent/pruner.js` (new export + call at top of `pruneMessages`)
- Test: `tests/step4-session.test.js` (extend — it already imports `pruneMessages`)

- [ ] **Step 1: Write the failing test** — append to `tests/step4-session.test.js` inside its top-level describe (or as a new describe; import `truncateOversizedToolResults` from `../src/agent/pruner.js`):

```js
describe('truncateOversizedToolResults', () => {
  test('function response over 25% of budget is cut and marked', () => {
    const big = 'x'.repeat(40000); // ~10k tokens, budget 1000 → cap 250 tokens = 1000 chars
    const messages = [
      { role: 'user', parts: [{ text: 'go' }] },
      { role: 'model', parts: [{ functionCall: { name: 'read_file', args: {} } }] },
      { role: 'function', parts: [{ functionResponse: { name: 'read_file', response: { content: big } } }] },
    ];
    const out = truncateOversizedToolResults(messages, 1000);
    const resp = out[2].parts[0].functionResponse.response;
    assert.equal(resp.truncated, true);
    assert.ok(/\[truncated \d+ chars\]/.test(resp.note));
    assert.ok(resp.content.length < big.length);
    // Original message object untouched (sessions treat messages as immutable)
    assert.equal(messages[2].parts[0].functionResponse.response.content.length, 40000);
  });

  test('small responses and non-function messages pass through unchanged', () => {
    const messages = [
      { role: 'user', parts: [{ text: 'hi' }] },
      { role: 'function', parts: [{ functionResponse: { name: 't', response: { content: 'ok' } } }] },
    ];
    const out = truncateOversizedToolResults(messages, 100000);
    assert.equal(out[0], messages[0]);
    assert.equal(out[1], messages[1]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/step4-session.test.js`
Expected: FAIL — `truncateOversizedToolResults` is not exported.

- [ ] **Step 3: Write minimal implementation** — in `src/agent/pruner.js`, add above `pruneMessages`:

```js
/**
 * A single tool result may never exceed this fraction of the context budget;
 * anything larger is cut so one giant read_file cannot blow past the
 * 92%-trigger / 60%-target compact margin between iterations.
 */
const MAX_SINGLE_RESPONSE_RATIO = 0.25;

/**
 * Returns a copy of `messages` with any functionResponse whose estimate
 * exceeds maxTokens * MAX_SINGLE_RESPONSE_RATIO replaced by a truncated
 * variant carrying a `[truncated N chars]` note. Message objects are never
 * mutated — replaced messages are fresh copies (session immutability rule).
 *
 * @param {Array<object>} messages
 * @param {number} maxTokens - context budget in tokens (not the 92% trigger)
 * @returns {Array<object>}
 */
export function truncateOversizedToolResults(messages, maxTokens) {
  if (!Array.isArray(messages) || !(maxTokens > 0)) return messages || [];
  const maxChars = Math.floor(maxTokens * MAX_SINGLE_RESPONSE_RATIO) * CHARS_PER_TOKEN;

  return messages.map((msg) => {
    if (!msg || msg.role !== 'function' || !Array.isArray(msg.parts)) return msg;
    if (estimateTokens(msg) <= maxTokens * MAX_SINGLE_RESPONSE_RATIO) return msg;

    return {
      ...msg,
      parts: msg.parts.map((part) => {
        const fr = part?.functionResponse;
        if (!fr) return part;
        let json;
        try {
          json = JSON.stringify(fr.response ?? '');
        } catch {
          json = String(fr.response ?? '');
        }
        if (json.length <= maxChars) return part;
        return {
          ...part,
          functionResponse: {
            ...fr,
            response: {
              content: json.slice(0, maxChars),
              truncated: true,
              note: `[truncated ${json.length - maxChars} chars]`,
            },
          },
        };
      }),
    };
  });
}
```

Wire it into `pruneMessages` — first lines after the empty-array guard:

```js
  const maxTokens = options.maxTokens || DEFAULT_MAX_CONTEXT_TOKENS || 800000;
  messages = truncateOversizedToolResults(messages, maxTokens);
```

(`messages` is the parameter; reassigning it before any read is safe here because the guard above already returned for non-arrays. Add `// ponytail: reassigning param for the smallest diff; rename to `working` if this function ever grows.`)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/step4-session.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/pruner.js tests/step4-session.test.js
git commit -m "feat(pruner): truncate oversized tool results at 25% of context budget"
```

---

### Task 3: compactor.js — new module

**Files:**
- Create: `src/agent/compactor.js`
- Test: `tests/compactor.test.js`

- [ ] **Step 1: Write the failing test** — create `tests/compactor.test.js`:

```js
/**
 * Unit tests: context compactor (LLM summary, digest fallback, archive,
 * boundary safety, abort semantics). Stub llmClient — no network.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { compactSession, splitForCompact, COMPACT_KEEP_RECENT } from '../src/agent/compactor.js';
import { Session } from '../src/agent/session.js';

function turn(i) {
  return [
    { role: 'model', parts: [{ functionCall: { name: 'list_dir', args: { dirPath: `d${i}` } } }] },
    { role: 'function', parts: [{ functionResponse: { name: 'list_dir', response: { content: `out ${i}` } } }] },
  ];
}

function sessionWith(count) {
  const s = new Session({ messages: [{ role: 'user', parts: [{ text: 'original goal' }] }] });
  for (let i = 0; i < count; i++) s.messages.push(...turn(i));
  return s;
}

let tempDir;
beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faycli-compact-test-'));
});
afterEach(() => {
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
});

describe('splitForCompact', () => {
  test('empty head when history fits in keep window', () => {
    const { head, tail } = splitForCompact(sessionWith(2).messages, 10);
    assert.equal(head.length, 0);
    assert.ok(tail.length > 0);
  });

  test('tail never starts with an orphan function response', () => {
    // 20 turns = 41 messages; boundary lands mid-pair on a function msg
    const { head, tail } = splitForCompact(sessionWith(20).messages, COMPACT_KEEP_RECENT);
    assert.notEqual(tail[0].role, 'function');
    // Every function msg in tail has its model call in tail too
    for (let i = 0; i < tail.length; i++) {
      if (tail[i].role === 'function') {
        assert.equal(tail[i - 1].role, 'model');
        assert.ok(tail[i - 1].parts.some((p) => p.functionCall));
      }
    }
    assert.ok(head.length > 0);
  });
});

describe('compactSession', () => {
  test('LLM success: [summary, ...tail], archive holds head, metadata set', async () => {
    const session = sessionWith(20);
    session.sessionsDir = tempDir;
    const archivePath = path.join(tempDir, `${session.id}.archive.jsonl`);
    const client = { generate: async () => ({ text: 'SUMMARY TEXT' }) };

    const res = await compactSession(session, client, { archivePath });
    assert.equal(res.compacted, true);
    assert.equal(res.method, 'llm');

    const msgs = session.getMessages();
    assert.equal(msgs[0].role, 'user');
    assert.match(msgs[0].parts[0].text, /^\[Compact summary\]\nSUMMARY TEXT$/);
    assert.ok(msgs.length <= COMPACT_KEEP_RECENT + 1);

    const archived = fs.readFileSync(archivePath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(archived.length > 0);
    assert.equal(archived[0].parts[0].text, 'original goal');

    assert.equal(session.metadata.lastCompact.method, 'llm');
    assert.ok(session.metadata.lastCompact.tokensBefore >= session.metadata.lastCompact.tokensAfter);
  });

  test('LLM throws → digest fallback, method digest', async () => {
    const session = sessionWith(20);
    const client = { generate: async () => { throw new Error('429 rate limited'); } };
    const res = await compactSession(session, client, {
      archivePath: path.join(tempDir, 'a.jsonl'),
    });
    assert.equal(res.compacted, true);
    assert.equal(res.method, 'digest');
    assert.match(res.error, /429/);
    assert.match(session.getMessages()[0].parts[0].text, /\[Context digest\]/);
  });

  test('LLM returns empty text → digest fallback', async () => {
    const session = sessionWith(20);
    const res = await compactSession(session, { generate: async () => ({ text: '   ' }) }, {});
    assert.equal(res.method, 'digest');
  });

  test('abort during LLM call → rethrows, session untouched, no archive', async () => {
    const session = sessionWith(20);
    const before = session.getMessages().length;
    const controller = new AbortController();
    const archivePath = path.join(tempDir, 'abort.jsonl');
    const client = {
      generate: async () => {
        controller.abort(new Error('User interrupted'));
        throw new Error('Request aborted by user');
      },
    };
    await assert.rejects(
      () => compactSession(session, client, { signal: controller.signal, archivePath }),
      /aborted/i,
    );
    assert.equal(session.getMessages().length, before);
    assert.equal(fs.existsSync(archivePath), false);
  });

  test('nothing to compact → noop, session unchanged', async () => {
    const session = sessionWith(2);
    let called = false;
    const res = await compactSession(session, { generate: async () => { called = true; return { text: 'x' }; } }, {});
    assert.equal(res.compacted, false);
    assert.equal(res.method, 'noop');
    assert.equal(called, false);
  });

  test('archive append failure warns but still compacts', async () => {
    const session = sessionWith(20);
    const warnings = [];
    const res = await compactSession(session, { generate: async () => ({ text: 'S' }) }, {
      archivePath: path.join(tempDir, 'missing-sub', 'deep.jsonl'), // dir does not exist → append fails
      logger: { warn: (m) => warnings.push(m), info: () => {}, error: () => {} },
    });
    assert.equal(res.compacted, true);
    assert.ok(warnings.some((w) => /archive/.test(w)));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/compactor.test.js`
Expected: FAIL — cannot find module `../src/agent/compactor.js`.

- [ ] **Step 3: Write minimal implementation** — create `src/agent/compactor.js`:

```js
/**
 * Context Compactor
 * Replaces old conversation turns with a single summary message so the ReAct
 * loop can run unbounded inside a finite context window. Strategy: LLM-written
 * summary → mechanical digest fallback (pruner.buildSummaryMessage) → noop.
 * Raw replaced turns are archived to <sessionsDir>/<id>.archive.jsonl before
 * the session is rewritten, so nothing is truly lost.
 */

import fs from 'node:fs';
import { buildSummaryMessage } from './pruner.js';
import { getContextTokens, resetUsage } from './usage.js';
import { logger as defaultLogger } from '../utils/logger.js';

/** Recent messages kept verbatim after the summary. Mirrors pruner's preserveRecentCount. */
export const COMPACT_KEEP_RECENT = 10;

/**
 * Instruction appended after the history when asking the LLM for a summary.
 * Provider-agnostic: plain user message, no tool declarations.
 */
const COMPACT_INSTRUCTION = `CONTEXT COMPACTION: The conversation above is being compressed to free context window space. Write a dense summary of everything above as plain text covering, in order:
1. USER GOAL — what the user asked for, verbatim intent
2. KEY DECISIONS — choices made and why
3. FILES TOUCHED — every file read/written/patched and what changed
4. TOOL OUTCOMES — commands run and their results (success/failure), errors still unresolved
5. OPEN THREADS — what remains to be done, in order
Be factual and complete; drop only pleasantries. Do not answer the user, do not continue the task, do not call tools.`;

/**
 * Splits messages into head (to be summarized) and tail (kept verbatim).
 * Boundary slides forward while the tail would start with an orphan
 * function response, so tool calls never get separated from their results
 * at the cut point.
 *
 * @param {Array<object>} messages
 * @param {number} [keepRecentCount=COMPACT_KEEP_RECENT]
 * @returns {{head: Array<object>, tail: Array<object>}}
 */
export function splitForCompact(messages, keepRecentCount = COMPACT_KEEP_RECENT) {
  if (!Array.isArray(messages) || messages.length === 0) return { head: [], tail: [] };
  if (messages.length <= keepRecentCount) return { head: [], tail: [...messages] };

  let boundary = messages.length - keepRecentCount;
  while (boundary < messages.length && messages[boundary]?.role === 'function') {
    boundary++;
  }
  return { head: messages.slice(0, boundary), tail: messages.slice(boundary) };
}

/**
 * Appends archived messages as one JSON per line. Failure is non-fatal —
 * the caller logs and continues; losing the archive must never block
 * compaction of the live session.
 * @param {string} archivePath
 * @param {Array<object>} messages
 */
function appendArchive(archivePath, messages) {
  const payload = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';
  fs.appendFileSync(archivePath, payload, { encoding: 'utf8', mode: 0o600 });
}

/**
 * Compacts a session in place.
 *
 * @param {import('./session.js').Session} session
 * @param {object|null} llmClient - client with .generate({contents, timeoutMs, signal})
 * @param {object} [options={}]
 * @param {number} [options.keepRecentCount=COMPACT_KEEP_RECENT]
 * @param {string|null} [options.archivePath] - null skips archiving
 * @param {AbortSignal} [options.signal] - user abort; rethrown, session untouched
 * @param {number} [options.timeoutMs=30000] - summary request timeout
 * @param {object} [options.logger]
 * @returns {Promise<{compacted: boolean, tokensBefore: number, tokensAfter: number, method: 'llm'|'digest'|'noop', error?: string}>}
 */
export async function compactSession(session, llmClient, options = {}) {
  const logger = options.logger || defaultLogger;
  const keepRecentCount = options.keepRecentCount ?? COMPACT_KEEP_RECENT;
  const tokensBefore = getContextTokens(session);
  const { head, tail } = splitForCompact(session.getMessages(), keepRecentCount);

  if (head.length === 0) {
    return { compacted: false, tokensBefore, tokensAfter: tokensBefore, method: 'noop' };
  }

  let summaryMsg = null;
  let method = 'digest';
  let error;

  if (llmClient && typeof llmClient.generate === 'function') {
    try {
      const result = await llmClient.generate({
        contents: [...head, { role: 'user', parts: [{ text: COMPACT_INSTRUCTION }] }],
        timeoutMs: options.timeoutMs ?? 30000,
        signal: options.signal,
      });
      const text = typeof result?.text === 'string' ? result.text.trim() : '';
      if (text) {
        summaryMsg = { role: 'user', parts: [{ text: `[Compact summary]\n${text}` }] };
        method = 'llm';
      } else {
        error = 'empty summary';
      }
    } catch (err) {
      if (options.signal?.aborted) throw err; // user abort: never rewrite the session
      error = err.message;
    }
  } else {
    error = 'no generate() on client';
  }

  if (!summaryMsg) {
    summaryMsg = buildSummaryMessage(head);
    method = 'digest';
  }

  // Archive AFTER the summary is decided, BEFORE the replace — an abort
  // mid-generate leaves no orphan archive entries.
  if (options.archivePath) {
    try {
      appendArchive(options.archivePath, head);
    } catch (err) {
      logger.warn(`[Compact] archive write failed (${err.message}); continuing without archive`);
    }
  }

  session.setMessages([summaryMsg, ...tail]);
  resetUsage(session); // old real-usage anchor describes the replaced history
  const tokensAfter = getContextTokens(session);
  session.metadata.lastCompact = {
    at: new Date().toISOString(),
    tokensBefore,
    tokensAfter,
    method,
  };
  logger.info(`[Compact] ${method}: ${tokensBefore} → ${tokensAfter} tokens (${head.length} msgs archived)`);
  return { compacted: true, tokensBefore, tokensAfter, method, error };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/compactor.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agent/compactor.js tests/compactor.test.js
git commit -m "feat(agent): LLM context compactor with digest fallback and jsonl archive"
```

---

### Task 4: orchestrator.js — unlimited loop + compact-on-budget

**Files:**
- Modify: `src/agent/orchestrator.js`
- Test: `tests/step4-orchestrator.test.js` (extend + update one existing test)

- [ ] **Step 1: Write the failing tests** — append a new describe to `tests/step4-orchestrator.test.js`:

```js
describe('Unlimited loop with auto-compact', () => {
  let tempDir;
  let sessionManager;
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faycli-unlimited-test-'));
    sessionManager = new SessionManager({ sessionsDir: tempDir });
  });
  afterEach(() => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  test('default maxIterations is Infinity and loop runs past 30', async () => {
    let callCount = 0;
    const mock = {
      getModel: () => 'gemini-2.5-flash',
      generateStream: async () => {
        callCount++;
        if (callCount >= 35) return { text: 'done', functionCalls: [] };
        return { text: 'tick', functionCalls: [{ name: 'list_dir', args: { dirPath: '.' } }] };
      },
    };
    const session = sessionManager.createSession({ workingDir: tempDir });
    const orchestrator = new AgentOrchestrator({
      llmClient: mock, session, workingDir: tempDir, autoApprove: true,
      reflectionInterval: 0, // reflection would stop the repetitive loop
    });
    assert.equal(orchestrator.maxIterations, Infinity);
    const result = await orchestrator.runTurn('keep ticking');
    assert.equal(result.iterations, 35);
    assert.equal(result.loopLimitReached, false);
    assert.equal(result.success, true);
  });

  test('budget exceeded triggers compact then continues (not break)', async () => {
    let callCount = 0;
    const mock = {
      getModel: () => 'gemini-2.5-flash',
      generateStream: async () => {
        callCount++;
        if (callCount >= 2) return { text: 'finished', functionCalls: [] };
        return {
          text: 'big turn',
          functionCalls: [{ name: 'list_dir', args: { dirPath: '.' } }],
          usage: { promptTokenCount: 950000, candidatesTokenCount: 10, totalTokenCount: 950010 },
        };
      },
      generate: async () => ({ text: 'compact summary' }), // compactSession LLM call
    };
    const session = sessionManager.createSession({ workingDir: tempDir });
    // Pre-seed 12 turns so the session exceeds COMPACT_KEEP_RECENT (10) —
    // otherwise splitForCompact returns an empty head and compact is a noop.
    for (let i = 0; i < 12; i++) {
      session.addMessage({ role: 'model', parts: [{ functionCall: { name: 'list_dir', args: { dirPath: `d${i}` } } }] });
      session.addFunctionResponseMessage('list_dir', { content: `out ${i}` });
    }
    const orchestrator = new AgentOrchestrator({
      llmClient: mock, session, workingDir: tempDir, autoApprove: true,
      maxContextTokens: 1000000, // trigger = 920k; iter 1 records 950k real → over
      reflectionInterval: 0,
    });
    const compactEvents = [];
    const result = await orchestrator.runTurn('go', {
      onCompactStart: () => compactEvents.push('start'),
      onCompactEnd: (r) => compactEvents.push(['end', r.method]),
    });
    assert.equal(callCount, 2); // loop continued past the budget check
    assert.equal(result.text, 'finished');
    assert.deepEqual(compactEvents, ['start', ['end', 'llm']]);
    assert.match(session.getMessages()[0].parts[0].text, /\[Compact summary\]/);
  });

  test('two consecutive noop compacts break the loop with warning', async () => {
    // One giant model text message alone exceeds budget; head is empty
    // (session fits in keep window) so compact can only noop.
    const mock = {
      getModel: () => 'gemini-2.5-flash',
      generateStream: async () => ({
        text: 'x'.repeat(4000000), // ~1M est tokens, no usage anchor
        functionCalls: [],
      }),
    };
    const session = sessionManager.createSession({ workingDir: tempDir });
    const orchestrator = new AgentOrchestrator({
      llmClient: mock, session, workingDir: tempDir,
      maxContextTokens: 100000, reflectionInterval: 0,
    });
    const result = await orchestrator.runTurn('go');
    // Iteration 1 stores the giant reply and exits normally (no tool calls),
    // so force a tool-calling variant instead:
    assert.equal(result.success, true);
  });
});
```

**Replace the noop-guard test above with this working version** (the giant reply must be a tool call so the loop returns to the budget check):

```js
  test('two consecutive noop compacts break the loop with warning', async () => {
    const giant = 'x'.repeat(400000); // ~100k est tokens per function response
    const mock = {
      getModel: () => 'gemini-2.5-flash',
      generateStream: async () => ({
        text: 'y'.repeat(400000),
        functionCalls: [{ name: 'list_dir', args: { dirPath: '.' } }],
      }),
    };
    const session = sessionManager.createSession({ workingDir: tempDir });
    const warnings = [];
    const orchestrator = new AgentOrchestrator({
      llmClient: mock, session, workingDir: tempDir, autoApprove: true,
      maxContextTokens: 100000, // trigger 92k — first turn already over
      reflectionInterval: 0,
      logger: { warn: (m) => warnings.push(m), info: () => {}, error: () => {} },
    });
    const result = await orchestrator.runTurn('go');
    assert.equal(result.loopLimitReached, false);
    assert.ok(warnings.some((w) => /compaction could not reduce/i.test(w)));
    assert.ok(result.iterations <= 5, `expected early break, got ${result.iterations}`);
    void giant;
  });
```

Note: with `maxContextTokens: 100000`, the estimator (no usage anchor) crosses 92k on iteration 2's top check; head is empty (session ≤ 10 messages) → noop ×2 → break.

- [ ] **Step 2: Update the existing budget-stop test** — in `tests/step4-orchestrator.test.js`, the test `'budget check stops the loop when real context exceeds the limit'` (line ~417) changes behavior: budget now compacts (digest fallback — mock has no `generate`) instead of breaking. With 3 messages the head is empty → noop ×2 → break at iteration 3. Replace its assertions:

```js
    // Iteration 1 passes the estimator check (no usage yet), records 950k real
    // usage; iteration 2's getContextTokens() exceeds the 920k trigger → compact.
    // Head is empty (3 messages ≤ keep window) → noop ×2 → break at iteration 3.
    assert.equal(callCount, 1);
    assert.equal(result.iterations, 3);
    assert.equal(result.loopLimitReached, false);
    assert.equal(result.success, true);
```

Wait — 700000 > 920000 is false. The old test used the 85% limit (680k). With the 92% trigger, 700k no longer exceeds 920k. **Bump the mock usage** so it crosses the new trigger: change `promptTokenCount: 700000` → `950000` and `totalTokenCount: 700010` → `950010` in that test, keep the new assertions above.

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tests/step4-orchestrator.test.js`
Expected: FAIL — `orchestrator.maxIterations` is 30, not Infinity; compact hooks never fire.

- [ ] **Step 4: Write minimal implementation** — in `src/agent/orchestrator.js`:

Imports — add:

```js
import path from 'node:path';
import { compactSession } from './compactor.js';
```

Constant:

```js
export const DEFAULT_MAX_ITERATIONS = Infinity;
```

Constructor — after `this.reflectionInterval = ...` add:

```js
    this.compactTimeoutMs = options.compactTimeoutMs ?? 30000;
```

JSDoc for `maxIterations` param: change `Maximum autonomous loop turns` → `Maximum autonomous loop turns (default Infinity — the context window is the limit)`.

Add a private helper to the class:

```js
  /**
   * Archive file for replaced raw turns: <sessionsDir>/<id>.archive.jsonl.
   * Null when the session has no storage dir (in-memory test sessions).
   * @returns {string|null}
   */
  _archivePath() {
    const dir = this.session?.sessionsDir;
    const id = this.session?.id;
    if (!dir || !id) return null;
    return path.join(dir, `${String(id).replace(/[^a-zA-Z0-9_-]/g, '')}.archive.jsonl`);
  }
```

Replace the Step 0 budget block in `runTurn` (the `if (currentTokens > budgetLimit) { ...break; }`) with:

```js
      // Step 0: Context pressure check — compact and keep going. The only
      // hard stops left are: final text answer, abort, API error,
      // reflection, an explicit cap, or the double-noop guard below.
      const currentTokens = getContextTokens(this.session);
      const budgetLimit = contextBudgetLimit(this.maxContextTokens);
      if (currentTokens > budgetLimit) {
        if (typeof options.onCompactStart === 'function') options.onCompactStart();
        let compactResult;
        try {
          compactResult = await compactSession(this.session, this.llmClient, {
            archivePath: this._archivePath(),
            logger: this.logger,
            signal,
            timeoutMs: this.compactTimeoutMs,
          });
        } catch (compactErr) {
          // Abort during compaction propagates like any other abort.
          throw compactErr;
        }
        if (typeof options.onCompactEnd === 'function') options.onCompactEnd(compactResult);

        if (compactResult.compacted) {
          noopCompacts = 0;
          try {
            this.session.save();
          } catch (saveErr) {
            this.logger.warn(`Failed to persist session after compaction: ${saveErr.message}`);
          }
        } else {
          noopCompacts++;
          if (noopCompacts >= 2) {
            this.logger.warn(
              `Context over budget (${currentTokens.toLocaleString()} / ${budgetLimit.toLocaleString()}) ` +
                `but compaction could not reduce it (nothing left to compact). Stopping ReAct loop.`,
            );
            loopLimitReached = false;
            break;
          }
        }
        // Re-check budget next iteration; the real request for this
        // iteration has not been sent yet, so nothing is wasted.
        continue;
      }
```

Declare `let noopCompacts = 0;` next to `let loopLimitReached = false;`.

The `continue` re-runs `currentIteration++` — with `Infinity` cap that's free; with an explicit cap it costs one turn per compact, acceptable (documented in spec).

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/step4-orchestrator.test.js`
Expected: PASS (all, including the pre-existing `maxIterations: 3` cap test which still works).

- [ ] **Step 6: Full suite + lint**

Run: `npm test` then `npm run lint`
Expected: all pass; lint clean (fix with `npm run lint:fix` if Biome complains about formatting only).

- [ ] **Step 7: Commit**

```bash
git add src/agent/orchestrator.js tests/step4-orchestrator.test.js
git commit -m "feat(agent): unbounded ReAct loop with auto-compact at 92% context"
```

---

### Task 5: --max-iterations flag

**Files:**
- Modify: `src/cli/args.js`, `bin/tai.js`
- Test: `tests/step1-args.test.js` (extend)

- [ ] **Step 1: Write the failing test** — append to `tests/step1-args.test.js` (match its import of `parseArgs`):

```js
describe('--max-iterations', () => {
  test('space-separated value', () => {
    const { flags } = parseArgs(['--max-iterations', '5', 'hello']);
    assert.equal(flags.maxIterations, 5);
  });
  test('equals form', () => {
    const { flags } = parseArgs(['--max-iterations=12']);
    assert.equal(flags.maxIterations, 12);
  });
  test('invalid or missing value → null', () => {
    assert.equal(parseArgs(['--max-iterations', 'abc']).flags.maxIterations, null);
    assert.equal(parseArgs(['--max-iterations']).flags.maxIterations, null);
    assert.equal(parseArgs(['--max-iterations', '0']).flags.maxIterations, null);
    assert.equal(parseArgs(['--max-iterations', '-3']).flags.maxIterations, null);
  });
  test('absent → null (orchestrator default Infinity applies)', () => {
    assert.equal(parseArgs(['hi']).flags.maxIterations, null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/step1-args.test.js`
Expected: FAIL — `flags.maxIterations` is undefined.

- [ ] **Step 3: Write minimal implementation** — in `src/cli/args.js`: add `maxIterations: null, // --max-iterations <n> : cap ReAct loop (default unlimited)` to the `flags` object, and this branch before the `--list` branch:

```js
    } else if (arg.startsWith('--max-iterations=')) {
      const num = Number(arg.slice(17));
      if (Number.isInteger(num) && num > 0) flags.maxIterations = num;
    } else if (arg === '--max-iterations') {
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        const num = Number(args[++i]);
        if (Number.isInteger(num) && num > 0) flags.maxIterations = num;
      }
    } else if (arg === '--list') {
```

In `bin/tai.js`, the `createAgentOrchestrator({...})` call at line ~335: add

```js
    maxIterations: parsed.flags.maxIterations || undefined,
```

Also add a `--max-iterations <n>` line to the flags list in `src/cli/help.js` (match the existing entry format, description: `Cap autonomous loop turns (default: unlimited, context window is the limit)`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/step1-args.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/args.js bin/tai.js src/cli/help.js tests/step1-args.test.js
git commit -m "feat(cli): --max-iterations flag for CI-bounded agent loops"
```

---

### Task 6: /compact slash command + ∞ status line

**Files:**
- Modify: `src/cli/slash-commands.js`, `src/ui/box.js`, `src/cli/repl.js`
- Test: `tests/session-status-repl.test.js` (extend for status line; slash command covered by direct call test)

- [ ] **Step 1: Write the failing tests** — append:

```js
// in tests/session-status-repl.test.js (or a new describe there):
test('status line renders infinity cap as ∞', () => {
  const line = renderStatusLine({
    usage: { totalTokens: 1234, llmRequests: 2 },
    contextTokens: 100,
    contextBudget: 920000,
    iterations: 47,
    maxIterations: Infinity,
  });
  assert.match(line, /loop 47\/∞/);
});

// new file tests/slash-compact.test.js:
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { executeSlashCommand } from '../src/cli/slash-commands.js';
import { Session } from '../src/agent/session.js';

function turn(i) {
  return [
    { role: 'model', parts: [{ functionCall: { name: 'list_dir', args: { dirPath: `d${i}` } } }] },
    { role: 'function', parts: [{ functionResponse: { name: 'list_dir', response: { content: `o${i}` } } }] },
  ];
}

describe('/compact', () => {
  test('compacts live session and reports method', async () => {
    const session = new Session({ messages: [{ role: 'user', parts: [{ text: 'goal' }] }] });
    for (let i = 0; i < 20; i++) session.messages.push(...turn(i));
    const chunks = [];
    const orchestrator = {
      session,
      maxContextTokens: 1000000,
      llmClient: { generate: async () => ({ text: 'S' }) },
    };
    const res = await executeSlashCommand('/compact', {
      orchestrator,
      configMgr: { get: () => undefined },
      logger: { warn: () => {}, info: () => {}, error: () => {} },
      stream: { write: (c) => chunks.push(String(c)) },
    });
    assert.equal(res.handled, true);
    assert.equal(res.action, 'compact');
    assert.match(chunks.join(''), /llm/);
    assert.match(session.getMessages()[0].parts[0].text, /\[Compact summary\]/);
  });

  test('noop reports nothing to compact', async () => {
    const session = new Session({ messages: [{ role: 'user', parts: [{ text: 'goal' }] }] });
    const chunks = [];
    const res = await executeSlashCommand('/compact', {
      orchestrator: { session, llmClient: { generate: async () => ({ text: 'S' }) } },
      configMgr: { get: () => undefined },
      logger: { warn: () => {}, info: () => {}, error: () => {} },
      stream: { write: (c) => chunks.push(String(c)) },
    });
    assert.equal(res.handled, true);
    assert.match(chunks.join(''), /nothing to compact/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/session-status-repl.test.js tests/slash-compact.test.js`
Expected: FAIL — `loop 47/Infinity` rendered; unknown slash command for `/compact`.

- [ ] **Step 3: Write minimal implementation**

`src/ui/box.js` `renderStatusLine` — replace the loop segment:

```js
  if (iterations > 0 && maxIterations > 0) {
    segments.push(`loop ${iterations}/${Number.isFinite(maxIterations) ? maxIterations : '∞'}`);
  }
```

`src/cli/slash-commands.js` — add to the `SLASH_COMMANDS` help list: `{ cmd: '/compact', desc: 'Summarize older context now to free space (agent loop does it automatically at 92%)' }`. Import at top: `import { compactSession } from '../agent/compactor.js';`. Add a case before `case 'clear'`:

```js
    case 'compact': {
      if (!orchestrator?.session) {
        stream.write(`\n${ansi.yellow('⚠')} No active session context found.\n\n`);
        return { handled: true, action: 'compact', error: true };
      }
      const sess = orchestrator.session;
      const result = await compactSession(sess, orchestrator.llmClient, {
        archivePath: sess.sessionsDir
          ? `${path.join(sess.sessionsDir, String(sess.id).replace(/[^a-zA-Z0-9_-]/g, ''))}.archive.jsonl`
          : null,
        logger,
      });
      if (!result.compacted) {
        stream.write(`\n${ansi.dim('Nothing to compact — recent window already fits. Context: ')}${ansi.white(result.tokensBefore.toLocaleString())} ${ansi.dim('tokens')}\n\n`);
        return { handled: true, action: 'compact', method: 'noop' };
      }
      try { sess.save(); } catch (e) { logger.warn(`Failed to persist session after manual compact: ${e.message}`); }
      stream.write(
        `\n${ansi.green('✔')} Context compacted (${ansi.cyan(result.method)}): ` +
          `${ansi.white(result.tokensBefore.toLocaleString())} → ${ansi.white(result.tokensAfter.toLocaleString())} tokens\n\n`,
      );
      return { handled: true, action: 'compact', method: result.method };
    }
```

Check `path` is imported in slash-commands.js; add `import path from 'node:path';` if not.

`src/cli/repl.js` — in the `runTurn` options object, wire the compact hooks to the existing spinner (find where `onIterationStart` is passed):

```js
        onCompactStart: () => spinner.start('Compacting context…'),
        onCompactEnd: (r) => {
          if (r.compacted) {
            output.write(`${ansi.dim(`[context compacted: ${r.method}, ${r.tokensBefore.toLocaleString()}→${r.tokensAfter.toLocaleString()} tok]`)}\n`);
          }
        },
```

If the REPL turn path has no spinner instance, use `output.write` for both start and end lines instead — keep it one dim line per event.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/session-status-repl.test.js tests/slash-compact.test.js`
Expected: PASS.

- [ ] **Step 5: Full suite + lint**

Run: `npm test && npm run lint`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/cli/slash-commands.js src/ui/box.js src/cli/repl.js tests/session-status-repl.test.js tests/slash-compact.test.js
git commit -m "feat(cli): /compact command and infinite-loop status rendering"
```

---

### Task 7: e2e + CHANGELOG

**Files:**
- Modify: `scripts/test-e2e.js` (pass `--max-iterations`), `CHANGELOG.md`

- [ ] **Step 1:** Inspect `scripts/test-e2e.js` for agent-loop invocations; add `--max-iterations 10` to any spawned `tai` command that runs a real prompt (prevents an infinite hang in CI now that the default is unlimited). If it constructs `AgentOrchestrator` directly, pass `maxIterations: 10` instead.
- [ ] **Step 2:** Run `npm run test:e2e` — expected: same pass/fail state as before the change (record baseline before Task 4 if unsure).
- [ ] **Step 3:** Add a CHANGELOG entry under Unreleased: unlimited loop default, auto-compact at 92% with digest fallback, `--max-iterations`, `/compact`, `.archive.jsonl` transcripts.
- [ ] **Step 4:** Commit:

```bash
git add scripts/test-e2e.js CHANGELOG.md
git commit -m "chore(e2e): bound agent loops with --max-iterations; document unlimited loop"
```

---

## Self-Review

**1. Spec coverage:** trigger 92% + target 60% → Task 1. Oversized truncation → Task 2. LLM compact + digest fallback + archive + boundary + abort + noop + metadata → Task 3. Infinity default + compact-continue + hooks + double-noop guard → Task 4. `--max-iterations` → Task 5. `/compact` + `∞` status → Task 6. e2e bound + docs → Task 7. First-iteration check: covered — budget check sits at top of `while`, unchanged position. Reflection unchanged: no task touches it. ✓

**2. Placeholder scan:** Task 4 Step 1 contains a superseded draft test followed by its replacement — the replacement is marked explicitly; executor uses the second. Task 6 REPL spinner wiring has a conditional ("if no spinner") — acceptable, both branches give exact code. No TBD/TODO. ✓

**3. Type consistency:** `compactSession(session, llmClient, opts)` → `{compacted, tokensBefore, tokensAfter, method, error?}` used identically in Tasks 3/4/6. `splitForCompact`/`COMPACT_KEEP_RECENT` only in Task 3. `compactTargetLimit` only in Task 1 (exported for future use; spec §usage.js). `onCompactStart`/`onCompactEnd` names match between Tasks 4 and 6. Archive filename pattern `<id>.archive.jsonl` with the same `[^a-zA-Z0-9_-]` sanitizer in Tasks 3 (caller-supplied path), 4 (`_archivePath`), and 6 (slash command). ✓
