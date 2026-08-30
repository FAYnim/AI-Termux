# Design: Session Status Line (tokens · context · loops)

**Date**: 2026-08-30
**Status**: Approved (brainstorming session)
**Scope**: REPL display feature + small orchestrator/LLM-adapter plumbing

## Problem

Users have no visibility into how much of the session's limits they are consuming:

- **Tokens** — how much the session has billed (and how close the context is to the
  internal 85% budget cutoff where the ReAct loop force-stops).
- **Loops** — how many ReAct iterations a turn used against the `maxIterations` cap (default 30).

The LLM layer already parses `usage` metadata from Gemini and OpenAI responses, but the
orchestrator discards it. There is no display of any of this during a session (only the
on-demand `/session` slash command, which shows the char-based estimate).

## Decisions (agreed during brainstorming)

| Question | Decision |
| --- | --- |
| Metrics shown | Tokens used + context left, loops left. **No** $ cost, **no** live API credit balance. |
| Placement | One dim status line printed **above each new REPL prompt** (after each agent turn). No pinned bottom bar, no live mid-turn spinner counts. |
| Token source | Real API usage when the provider reports it; char-based estimator (`estimateSessionTokens`) as fallback. Estimated numbers get a `~` prefix. |
| Approach | **A** — orchestrator usage accumulator persisted in `session.metadata`; no LLM-layer refactor beyond the OpenAI streaming usage fix. |

## Display

After every agent turn (success, error, or abort), before the next prompt:

```
─ 23.4k tok │ ctx 12% │ loop 7/30 ─
termux-ai ❯ _
```

- `tok` — cumulative session tokens billed (prompt + completion) from real API usage.
  `~` prefix (e.g. `~23.4k tok`) when the number is estimator-derived because the
  provider does not report usage.
- `ctx` — context size of the *next* request (`getContextTokens()`) as a percentage of
  the budget limit (`floor(maxContextTokens * 0.85)`, current default 800k → limit
  680k). Same number the internal budget check uses, so the display can never disagree
  with the actual cutoff.
- `loop` — iterations used in the most recent turn vs `maxIterations` (per-turn cap; it
  resets each turn). Not printed before the first completed turn.
- Abbreviations `tok` / `ctx` / `loop` are deliberately **not localized** (universal
  abbreviations; avoids 3 i18n keys for glyphs).
- Rendered dim; single line; no glyph (the `⚡` glyph is reserved for `[TOOL]` lines).

## Components

### 1. `src/agent/usage.js` (new, ~70 lines, pure logic, no I/O)

```
createUsage() -> zeroed usage object
accumulateUsage(session, usage|null) -> session   // mutates session.metadata.usage
getContextTokens(session) -> number
contextBudgetLimit(maxContextTokens) -> number    // floor((maxContextTokens || 800000) * 0.85)
formatCompactTokens(n) -> string
```

`usage` object shape (stored at `session.metadata.usage`):

```
{
  promptTokens: number          // Σ prompt/context tokens across responses
  completionTokens: number      // Σ completion tokens
  totalTokens: number           // Σ total
  llmRequests: number           // count of usage-bearing responses
  lastPromptTokens: number      // context size of most recent request (0 = unknown)
  estTokensAtLastRequest: number// estimator snapshot taken just before that request
  updatedAt: string             // ISO timestamp of last accumulation
}
```

- `accumulateUsage(session, null)` is a no-op (provider didn't report usage).
- Callers pass usage already normalized to `{promptTokenCount, candidatesTokenCount,
  totalTokenCount}` — both existing adapters normalize to this shape;
  `accumulateUsage` maps it onto the stored shape.
- `contextBudgetLimit` is the **single source** for budget math (85% factor + the
  800k fallback for a falsy `maxContextTokens`, preserving current orchestrator
  behavior). Orchestrator Step 0 and the REPL both call it instead of duplicating
  the magic numbers.

`formatCompactTokens` rule: `n < 1000` → integer string (`"950"`); `1000 ≤ n < 1 000 000`
→ one decimal in `k`, trailing `.0` dropped (`23400` → `"23.4k"`, `1000` → `"1k"`);
`n ≥ 1 000 000` → one decimal in `M`, trailing `.0` dropped (`1000000` → `"1M"`,
`1234567` → `"1.2M"`). Round half-up at the one decimal.

`getContextTokens(session)` — context size for the next request:

```
est   = estimateSessionTokens(session)
usage = session.metadata.usage
if (!usage || !usage.lastPromptTokens) return est            // estimator fallback
return max(usage.lastPromptTokens,                           // real anchor
           usage.lastPromptTokens + (est - usage.estTokensAtLastRequest))
```

i.e. real anchor + estimated drift of messages appended since that request (tool
outputs are the big variable), never negative, never below the real anchor.

### 2. `src/agent/orchestrator.js` — three touch points in `runTurn`

1. **Before each `generateStream`**: record `estTokensAtLastRequest =
   estimateSessionTokens(session)` into `session.metadata.usage` (creating it via
   `createUsage()` if absent).
2. **After each stream response**: `accumulateUsage(session, streamResult.usage)`.
3. **Budget check (Step 0)** switches from `estimateSessionTokens(session)` to
   `getContextTokens(session)`; the limit becomes `contextBudgetLimit(this.maxContextTokens)`.
   Stop semantics unchanged: break without setting `loopLimitReached`.

Behavior change note: the cutoff becomes more accurate; a session whose real context
exceeds the budget may now stop earlier than the estimator alone would have indicated.

`runTurn`'s return shape is **unchanged** — the REPL reads totals from
`session.metadata.usage` directly.

### 3. `src/llm/openai.js` — streaming usage fix

Current streaming path hardcodes `usage: null` (line ~316) and early-returns on the
terminal empty-`choices` chunk (line ~244) — exactly the chunk OpenAI-compatible APIs
use to deliver usage.

- Parse `data.usage` on any SSE chunk (including the empty-`choices` terminal chunk),
  normalized to the existing `{promptTokenCount, candidatesTokenCount, totalTokenCount}`
  shape. Include it in the final return instead of the hardcoded `null`.
- Add `stream_options: { include_usage: true }` to the streaming request body so
  OpenAI's real API reports usage. If the server rejects the body with **400**, retry
  **once** without `stream_options` (a 400 generates nothing → no double-billing risk);
  if that retry also fails with 400, surface the original error unchanged. All other
  status codes behave exactly as today.

### 4. `src/ui/box.js` — `renderStatusLine(...)`

```
renderStatusLine({ usage, contextTokens, contextBudget, iterations, maxIterations }) -> string
```

Pure string + ANSI (box.js already owns ANSI helpers), single dim line per the Display
section. Uses `formatCompactTokens`. Omits the `loop` segment when `iterations` is
falsy (no turn completed yet). Uses `~` prefix when the provider did not report usage
(`usage.llmRequests === 0` or no real `lastPromptTokens`).

### 5. `src/cli/repl.js` — wiring

- Track `lastIterations` locally via the existing `onIterationStart` callback.
- After each agent turn — success, error, and abort paths alike — print
  `renderStatusLine(...)` once, then the next prompt. Data:
  - `usage` from `orchestrator.session.metadata.usage`
  - `contextTokens` via `getContextTokens(session)`, `contextBudget` = same 85% limit
    the orchestrator uses
  - `iterations` = last turn's iteration count (per-turn, from `onIterationStart`)
- Nothing printed before the first turn or after slash commands.
- Non-TTY output: line still prints as plain text (harmless, keeps tests simple).

### 6. `src/cli/slash-commands.js` — `/session` consistency

`/session` card gains rows for the real usage fields (prompt / completion / total /
LLM requests / last request context) alongside the existing estimator row, so both
surfaces agree.

## Data flow (turn lifecycle)

```
user submits line
  → runTurn()
      ├─ loop iteration: getContextTokens() budget check
      ├─ snapshot estTokensAtLastRequest
      ├─ generateStream() → streamResult.usage (Gemini today, OpenAI after fix)
      ├─ accumulateUsage(session, usage)
      └─ onIterationStart(iter) → REPL records lastIterations
  → REPL prints status line from session.metadata.usage
  → session.save() (already persists metadata.usage — resume keeps totals)
```

## Edge cases

| Case | Behavior |
| --- | --- |
| Provider omits usage | Accumulator stays zeroed → estimator fallback, `~` prefix on `tok`. |
| Ctrl+C mid-turn | `runTurn` throws but usage already accumulated → status line still prints. |
| Loop-limit or budget stop | Same line, no special casing. |
| `resume <session-id>` | Totals load from persisted `session.metadata.usage`. |
| Session message `clear()` | Cumulative usage intentionally survives (billing-history semantics). |
| Reflection-checker calls (`llmClient.generate()` every N iters) | **Not counted in v1** — documented limitation; accumulator can be wired later. |
| Multi-function-call iteration | Counts as one iteration (existing loop semantics). |

## Testing

- **New `tests/usage.test.js`** — accumulate (null / partial fields / repeated calls /
  shape normalization), `getContextTokens` (real anchor + delta, estimator fallback,
  no-negative clamp), `contextBudgetLimit` (given limit, falsy → 800k default), and
  `formatCompactTokens` boundaries (0, 999, 1 000, 23 400, 999 949, 1 000 000, 1 234 567).
- **Orchestrator tests** — fake llmClient whose `generateStream` result carries usage →
  `session.metadata.usage` accumulates across iterations and turns; budget check stops
  early when real context exceeds the limit; no usage → estimator path unchanged.
- **OpenAI adapter tests** — usage parsed from terminal empty-`choices` chunk;
  `stream_options` present in body; 400 → single retry without `stream_options`;
  other 4xx/5xx unchanged.
- **REPL tests** — line printed after a completed turn; not printed before first turn;
  printed after abort/error; absent after slash commands.

## Out of scope (YAGNI)

Config toggle, $ cost / credit display, live mid-turn spinner counts, single-shot /
piping mode output, reflection-token counting, pinned bottom status bar.

## Docs

- CHANGELOG Unreleased entry.
- One-line README feature mention.
- `/session` slash command updated as above.
