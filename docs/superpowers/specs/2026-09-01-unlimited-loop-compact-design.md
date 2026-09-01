# Unlimited ReAct Loop with LLM Auto-Compact — Design Spec

Date: 2026-09-01
Status: Approved by user (sections 1–3)
Target: `termux-ai-cli` (`src/agent/`)

## Problem

The ReAct loop in `src/agent/orchestrator.js` has three brakes:

1. **Iteration cap** — `DEFAULT_MAX_ITERATIONS = 30`; hitting it sets `loopLimitReached: true` and stops.
2. **Budget stop** — when estimated context > 85% of `maxContextTokens`, the loop `break`s entirely.
3. **Reflection** — every 3 iterations, can stop early when the model is stuck.

Goal: behave like Claude Code — **no iteration limit; the only limit is the context window**. When the window fills mid-loop, compact it with an LLM-generated summary and keep going.

## Decisions (locked during brainstorm)

| # | Decision |
|---|----------|
| 1 | Compaction strategy: **LLM auto-compact (A)** with **mechanical digest fallback (B)** |
| 2 | Trigger at **92%** of budget, compact target **~60%**; oversized tool results truncated as overflow guard |
| 3 | Iteration cap: **default unlimited**, keep `--max-iterations N` flag for e2e/CI |
| 4 | Compaction is **destructive** on the active session; raw head archived to per-session `.jsonl` |
| 5 | Manual **`/compact`** slash command exposed in REPL |
| 6 | Architecture: **new `src/agent/compactor.js` module**; orchestrator only swaps the brake (Option 1) |

## Architecture

```
orchestrator.runTurn()
  │
  ├─ while (iter < maxIters)          maxIters default Infinity; --max-iterations overrides
  │    ├─ getContextTokens(session)
  │    ├─ if tokens > 92% budget ──► compactSession(session, llmClient)   ◄─ NEW
  │    │                                ├─ success: session.messages = [summary, ...tail]
  │    │                                └─ failure: buildSummaryMessage() (mechanical digest)
  │    ├─ pruneMessages()               unchanged role: per-request safety net
  │    │                                + NEW: truncate oversized tool results
  │    └─ generateStream → tools → …    unchanged
  │
  └─ stops only on: model final text / user abort / API error / reflection stop /
     explicit cap / double-noop guard (see Edge cases)
```

### Components

#### 1. `src/agent/compactor.js` (new)

Single responsibility: compact a session's context. No I/O beyond archive append and session save (save stays with caller — see data flow).

```
compactSession(session, llmClient, options) -> Promise<{
  compacted: boolean,
  tokensBefore: number,
  tokensAfter: number,
  method: 'llm' | 'digest' | 'noop',
  error?: string
}>
```

Options: `{ maxContextTokens, keepRecentCount = 10, archivePath, logger, signal, timeoutMs }`.

Algorithm:

1. Split `session.messages` into **head** (everything except the last `keepRecentCount` messages) and **tail**.
2. Boundary safety: tail must not begin with an orphan `role:'function'` message — slide the boundary forward until the first tail message is `model` or `user` (same idea as `sanitizeConversationHistory` in `pruner.js`).
3. If head is empty → `method:'noop'`, return unchanged.
4. Send head to the LLM with a compaction instruction: produce a structured summary covering **user goal, key decisions, files touched, tool results status, open threads / what remains**. Plain user-message content — no provider-specific features (works on both gemini and openai adapters).
5. On success: `summaryMsg = { role:'user', parts:[{ text: '[Compact summary]\n' + summary }] }`.
6. On error/timeout/empty response: `summaryMsg = buildSummaryMessage(head)` (existing mechanical digest from `pruner.js`), `method:'digest'`.
7. Archive: append the replaced head messages, one JSON per line, to `<sessionsDir>/<id>.archive.jsonl` (`mode 0o600`, append-only). Written **after** the summary is decided, immediately **before** the replace — so an abort mid-LLM-call leaves no orphan archive entries.
8. `session.setMessages([summaryMsg, ...tail])`.
9. `resetUsage(session)` — the real-usage anchor from the old full history is invalid after replacement.
10. Set `session.metadata.lastCompact = { at, tokensBefore, tokensAfter, method }`.

Compaction never fails hard: LLM → digest → noop. The only fatal path is user abort (see Data flow).

#### 2. `src/agent/usage.js` (modified)

- `BUDGET_STOP_RATIO`: `0.85` → `0.92` (now the compact trigger).
- New `COMPACT_TARGET_RATIO = 0.6` and `compactTargetLimit(maxContextTokens)`.
- `contextBudgetLimit()` keeps its 800k fallback behavior.

#### 3. `src/agent/orchestrator.js` (modified)

- `DEFAULT_MAX_ITERATIONS = Infinity`. `options.maxIterations` (constructor and per-run) still overrides — `--max-iterations` path unchanged. `loopLimitReached` remains meaningful only when a cap is set.
- Step 0 budget check (top of every iteration, **including the first** — a resumed session plus a long prompt can already exceed 92% before any request goes out): instead of `break`, call `await compactSession(...)` then `continue` the loop. The main request for this iteration has not been sent yet, so no API spend is wasted.
- New optional hooks `options.onCompactStart()` / `options.onCompactEnd({tokensBefore, tokensAfter, method})` for REPL UI.
- Status line (`src/ui/box.js`): when `maxIterations` is `Infinity`, render `loop N/∞` (guard: current code checks `maxIterations > 0`; `Infinity > 0` is true, so only the formatting branch needs the `∞` case).

#### 4. `src/agent/pruner.js` (modified)

- New: truncate oversized single tool results before they enter the request payload — any `functionResponse` whose estimate exceeds **25% of budget** is cut to that cap with a trailing `[truncated N chars]` marker. This is the guard against one giant `read_file` blowing past the 92%→60% compact margin.
- Everything else unchanged; `pruneMessages` stays synchronous and remains the last-resort sliding-window net (also used when compact returns `noop` but the request still needs shrinking).

#### 5. `src/cli/slash-commands.js` + `src/cli/repl.js` (modified)

- `/compact` command: calls `compactSession` on the live session, prints `context: 210k → 58k (llm)` style result. No minimum threshold — manual request always executes (if head is empty it reports `noop`).
- REPL wires the compact hooks to the spinner ("Compacting context…") and refreshes the status line from `metadata.lastCompact`.

#### 6. `src/cli/args.js` (modified)

- Add `--max-iterations <n>` flag (single-shot and REPL startup), feeding `orchestrator.maxIterations`. `scripts/test-e2e.js` uses it instead of relying on the old default 30.

## Data flow (auto-compact mid-loop)

```
iteration N: getContextTokens > 92% budget
  ├─ onCompactStart()                       UI spinner
  ├─ generateContent(head + instruction, timeout = config.timeoutMs, signal)
  │    ├─ ok      → summary from LLM        (method 'llm')
  │    ├─ error   → buildSummaryMessage()   (method 'digest')
  │    └─ abort   → DO NOT replace session; rethrow abort like any other signal stop
  ├─ append head → <id>.archive.jsonl       (append failure = warn, continue)
  ├─ session.setMessages([summary, ...tail])
  ├─ resetUsage(session)
  ├─ session.save()                         atomic persist BEFORE next request
  └─ onCompactEnd({tokensBefore, tokensAfter, method})
  → continue iteration N (send the real request)
```

## Edge cases

- **Compact doesn't shrink** (short history, one giant message): oversized-result truncation in pruner handles it; compact returns `noop` and the loop continues. Anti-stall guard: **two consecutive `noop` results while still over budget → break with a warning** (the only remaining hard stop besides an explicit cap).
- **Abort during compact**: session untouched, no archive write (archive happens after the summary is decided).
- **`/compact` on small context**: allowed; head split still applies (keeps last 10). If nothing to take, reports `noop`.
- **Resume old sessions**: no migration. `archive.jsonl` is created on first compact; existing sessions just start archiving then.
- **OpenAI-compatible providers**: compaction instruction is an ordinary user message; no provider-specific requirement.
- **Reflection**: unchanged; still the automatic brake on stuck loops.

## Testing

Follows existing `node --test tests/*.test.js` pattern.

1. **`tests/compactor.test.js`** (unit, stub llmClient):
   - LLM success → `[summary, ...tail]`, archive `.jsonl` contains head, `metadata.lastCompact` set, `method:'llm'`
   - LLM throws → digest fallback, `method:'digest'`
   - tail boundary starting on `role:'function'` → slid forward, no orphan responses
   - abort signal → session unchanged, no archive write
   - empty head → `method:'noop'`
2. **`tests/step4-orchestrator.test.js`** (extend):
   - loop runs past 30 iterations with unlimited default (stub client counts iterations; no `loopLimitReached`)
   - budget exceeded → `compactSession` invoked → loop continues (not break)
   - `maxIterations: 5` override still caps
   - double-`noop` guard breaks with warning
3. **`tests/pruner.test.js`** (extend): `functionResponse` > 25% budget truncated with `[truncated N chars]` marker.
4. **`tests/usage.test.js`** (extend): ratio constants — trigger 0.92, target 0.6, target < trigger; `compactTargetLimit` math.
5. **E2E** (`scripts/test-e2e.js`): existing suite switched to `--max-iterations`; optional `/compact` smoke via stub provider.

## Out of scope

- Circuit breaker for repeated identical tool failures (deferred; reflection covers the common case).
- Non-destructive compaction / configurable keep-recent count.
- Session-file GC for `.archive.jsonl` growth.
