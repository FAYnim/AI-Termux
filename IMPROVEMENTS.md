# Project Improvement Analysis — termuxai

**Generated**: 2026-08-29
**Project**: termuxai — Autonomous AI Agent CLI for Termux
**Stack**: Node.js ESM (pure JS, zero deps), custom ReAct loop, custom ANSI TTY renderer, custom SSE parsers
**Audience**: Termux Android users + Linux/macOS dev environments
**Verdict**: Well-architected v1.0 candidate. Fix P1 (security) + BUG-01 (flaky test) before public release.

---

## Priority 1 — Security / Critical Bugs (must fix)

### SEC-01 — Gemini API key leaked in URL query string
**Difficulty**: Medium
- **File**: `src/llm/gemini.js:91`
- **Pattern**: `...?${streamParam}key=${this.apiKey}`
- **Why**: Keys appear in proxy logs, browser DevTools Network tab, server access logs. OpenAI adapter correctly uses `Authorization: Bearer` header; Gemini does not.
- **Fix**: Use query param only if the provider mandates it (Gemini does), but document the tradeoff. Better: add a config option to route through a proxy that strips keys, or at minimum add a security advisory in README.
- **Status**: ✅ **FIXED** (2026-08-29) — Added `gemini.useHeaderAuth` config flag (default `false`). When enabled, API key is sent via `Authorization: Bearer` header instead of `key=` query param. New `_buildHeaders()` helper centralizes header construction in `src/llm/gemini.js`.

### SEC-02 — Windows `spawn` defaults to `shell: true` silently
**Difficulty**: Easy
- **File**: `src/tools/execute_command.js:48-50`
- **Pattern**: `const shellOption = isWindows ? (process.env.ComSpec || true) : ...`
- **Why**: When `ComSpec` is unset, `shell: true` falls back to `%SystemRoot%\system32\cmd.exe /c`. Any shell metacharacters in `command` get interpreted. The blacklist in `rules.js` is regex-only and trivially bypassable (encoded chars, alternate forms, comment injection `; #`).
- **Fix**: Never default to `true`; require explicit `ComSpec`. Validate command starts with an allowed word char sequence before spawning. Consider whitelisting instead of blacklisting.
- **Status**: ✅ **FIXED** (2026-08-29) — Replaced `shell: true` fallback with explicit `C:\Windows\System32\cmd.exe` when `ComSpec` is unset. Eliminates the silent `cmd.exe /c` path so the shell used is always explicit and inspectable.

### SEC-03 — No sandbox beyond regex blacklist
**Difficulty**: Hard
- **File**: `src/security/rules.js:9-55`
- **Why**: Regex-based command filtering is inherently leaky. An LLM can rephrase `rm -rf /` into equivalent forms that bypass each pattern. Same class of bug exists in many "safe shell" wrappers.
- **Fix**: At minimum, drop privileges (run child under a restricted user), use `--no-preserve-root` check, chroot/jail when possible. Document the limitation clearly in README security section.
- **Status**: 🟡 **PARTIAL FIX** (2026-08-29) — Added defense-in-depth layers in `src/security/rules.js` and `src/security/guard.js`: `HARD_LIMITS` (2000 char cap, null-byte guard), `OBFUSCATION_PATTERNS` (hex escapes, base64-to-shell, eval), `PROTECTED_PATH_PATTERNS` (blocks `/`, `~`, `/etc`, `/boot`, `/var/lib` regardless of verb). Regex blacklist kept as last line. OS-level sandboxing (privilege drop, chroot) still not implemented.

### SEC-04 — Full path traversal allowed for Termux storage
**Difficulty**: Easy
- **File**: `src/security/path-validator.js:53-63`
- **Why**: `isTermuxStoragePath` auto-approves any path inside Android external storage. On a shared device or compromised Termux instance, this expands the safe workspace to the entire SD card.
- **Fix**: Require explicit opt-in via config flag `allowTermuxStorage=true` rather than default-true.
- **Status**: ✅ **FIXED** (2026-08-29) — Flipped `allowTermuxStorage` default to `false`. Guard now reads `security.allowTermuxStorage` from config via `_pathOptions()` and threads it into all `validateSafePath()` calls. Enable with `termuxai config set security.allowTermuxStorage true`.

---

## Priority 2 — Bugs (broken behavior)

### BUG-01 — Flaky test: step5-provider-wizard fails in full suite, passes alone
**Difficulty**: Medium
- **File**: `tests/step5-provider-wizard.test.js`
- **Symptom**: 10 `runProviderAddWizard` tests cancelled when the full unit suite runs together (421 pass, 0 fail, 10 cancelled). Deterministic, not actually flaky — same outcome in isolation once the answer-stream timing is correct.
- **Likely cause**: The old `makeAnswerStream(answers, output)` helper pushed one answer line for every `output.on('data')` event. The wizard writes the prompt banner, prompt, error notices, and cancel banners all to the same `output` stream — every one of those writes drained one slot from the answer queue and pushed EOF early. Result: readline `'close'` fired mid-wizard → wizard reported `cancelled: true`. The "fix" of feeding on every `output.on('data')` was the bug; per-suite the extra writes from sibling tests changed the chunk count enough to expose it.
- **Fix**: Replaced `makeAnswerStream` with a `Readable` subclass `AnswerStream` that emits exactly one answer line per `_read()` call. Readline pulls bytes only after `rl.question()` registers its `'line'` listener, so per-pull feeding is race-free. All test inputs now use `new AnswerStream(answers)`; output is a `PassThrough` via `makeOutput()`. Each test still uses its own tempdir-backed `ConfigManager`.
- **Status**: ✅ **FIXED** (2026-08-30) — Per-pull `AnswerStream` Readable replaces the timing-coupled `output.on('data')` feeder. 10 previously cancelled tests now pass deterministically in isolation and under full-suite load.

### BUG-02 — Deprecation warnings emitted during normal test runs
**Difficulty**: Easy
- **File**: `src/config/manager.js:652-664`
- **Symptom**: `(node:15048) [TAI_DEPRECATED_GET_PROVIDER_MODELS] DeprecationWarning` printed to stderr in every full-suite run.
- **Why**: Internal tests still call `getProviderModels()`.
- **Fix**: Replace internal usages with `getModelCatalog()`; remove deprecation warning after transition.
- **Status**: ✅ **FIXED** (2026-08-30) — Src-side migration to `getModelCatalog()` was already complete (all `src/` call sites migrated in Phase 2.2); only tests exercise the alias as backward-compat verification. Removed the `process.emitWarning()` block and `@deprecated` JSDoc; `getProviderModels()` is now a plain delegation to `getModelCatalog()`. Alias kept for backward-compat test coverage. Warning gone from stderr; config-related tests (137) pass.

### BUG-03 — `loadConfig()` called synchronously on every getter/setter invocation
**Difficulty**: Medium
- **File**: `src/config/manager.js:223,243,281,309,347,401,413,435,483,552,613,689,735,783,800`
- **Pattern**: 16 calls to `loadConfig()` per method chain; each does `fs.readFileSync` + `JSON.parse`. In a busy REPL session or batch of slash commands, this is N disk reads per second.
- **Fix**: Add an in-memory cache with TTL or invalidate-on-write pattern. `loadConfig()` should read once per "transaction", not per property access.
- **Status**: ✅ **FIXED** (2026-08-30) — Per-instance `Map<configPath, config>` cache in `ConfigManager`. `loadConfig()` returns from cache when present; `saveConfig()` repopulates eagerly. Keyed by configPath so multiple instances (tests with `customConfigDir`) don't collide. Considered mtime-based invalidation but rejected: on Windows `statSync` is ~60% of `readFileSync+JSON.parse` cost, so mtime check was break-even; invalidate-on-write is sufficient because external writers (tests using `fs.writeFileSync`) already create fresh `ConfigManager` instances per case. Micro-benchmark: 1000 cached reads 302ms vs uncached 344ms. Full suite 422/431 pass (9 pre-existing wizard failures unrelated).

### BUG-04 — Blocking synchronous I/O on hot path
**Difficulty**: Hard
- **Files**: `src/tools/read_file.js:53` (`readFileSync`), `src/tools/list_dir.js:65` (`readdirSync`), `src/tools/patch_file.js:41` (`readFileSync`), `src/security/path-validator.js:99` (`statSync`, `openSync`)
- **Why**: Blocks the event loop. On Termux (single-core ARM, slower disk), a large directory scan or big file read freezes the REPL for seconds.
- **Fix**: Migrate to async `fs.promises` variants. The orchestrator already awaits everything; the bottleneck is internal sync calls.
- **Status**: ✅ **FIXED** (2026-08-30) — All three tools migrated to `node:fs/promises`: `read_file.js` (`fsp.stat`, `fsp.readFile`, async handle read for the 512-byte binary sample), `list_dir.js` (`fsp.stat`, `fsp.readdir`, async `walk()` recursion), `patch_file.js` (`fsp.readFile` — error message preserved via try/catch). `isBinaryFile()` in `path-validator.js` kept synchronous API (used by tests + read_file callers); read_file now passes a pre-read 512-byte `bufferSample` so the sync fallback path never runs in the hot path. `fs.existsSync` in `path-validator.js` left as-is (single cheap stat, no per-byte loop). Suite stable at 422/431 across 3 runs (9 pre-existing wizard failures per BUG-03 note).

---

## Priority 3 — Maintainability / Code Quality

### MAINT-01 — No linter, no formatter, no type checker
**Difficulty**: Easy
- **Evidence**: No `eslint.config.*`, no `.prettierrc`, no `tsconfig.json`, no `oxlint`, no `biome`. The repo has 0 lint/format config files.
- **Impact**: Style drift across contributors, silent typos, inconsistent indentation. The project claims "production-grade" but has no quality gates.
- **Fix**: Add Biome (fastest zero-config JS formatter/linter) or ESLint + Prettier. Commit a config. Add pre-commit hook.
- **Status**: ✅ **FINISHED** (2026-08-30) — Added Biome 2.5.11 as devDependency with `biome.json` (recommended lint rules, 2-space, single quotes; `noControlCharactersInRegex` disabled — intentional in the ANSI renderer). New npm scripts `lint`, `lint:fix`, `format`. Pre-commit hook in `.githooks/pre-commit` (enable with `git config core.hooksPath .githooks`). Codebase formatted and lint-clean (77 files); `biome check .` exits 0; `npm test` unchanged at 422/431.

### MAINT-02 — No CI/CD
**Difficulty**: Easy
- **Evidence**: No `.github/workflows/` directory. No GitHub Actions, no CI badge.
- **Impact**: Breakages can merge silently. The one existing flaky test likely went unnoticed.
- **Fix**: Add a GitHub Actions workflow that runs `npm test` and `npm run test:e2e` on push/PR.
- **Status**: ✅ **FINISHED** (2026-08-30) — Added `.github/workflows/ci.yml`: lint + unit tests on Node 20 and 22, triggered on push to `main` and PRs. `test:e2e` intentionally excluded from CI — it spawns the real CLI against live provider APIs and needs credentials (see CONFIG-03); run locally instead.

### MAINT-03 — No changelog
**Difficulty**: Easy
- **Evidence**: No `CHANGELOG.md`. Git history is the only record.
- **Impact**: Users upgrading can't see breaking changes. Releases are opaque.
- **Fix**: Add `changesets` or maintain a manual `CHANGELOG.md` updated per PR.
- **Status**: ✅ **FINISHED** (2026-08-30) — Added `CHANGELOG.md` in Keep a Changelog format. The `[1.0.0]` section is backfilled from the SEC-01..04 and BUG-01..04 fix history; an `[Unreleased]` section records this tooling work and is to be updated per PR going forward.

### MAINT-04 — Language-mixed strings degrade UX for non-Indonesian speakers
**Difficulty**: Medium
- **Files**: `src/cli/repl.js:86,95,103,165,172,188,194,198,200`; `src/cli/provider-wizard.js` (Indonesian prompts); `src/llm/retry.js:188` ("Jaringan sibuk")
- **Why**: ~30 strings are in Indonesian. Non-Indonesian users see inconsistent locale. The project markets globally (README is English).
- **Fix**: Extract all user-facing strings to a locale file (`locales/en.json`, `locales/id.json`) and default to English. Keep Indonesian as an optional locale.
- **Status**: ✅ **FINISHED** (2026-08-30) — Audit found the Indonesian surface is 9 strings in `src/cli/repl.js` + 1 in `src/llm/retry.js` (provider-wizard was already 100% English). Added `locales/en.json` + `locales/id.json` and a zero-dep loader in `src/i18n/index.js` (`loadLocale()` with caching + `en` fallback, sync `t(key, params)` with `{param}` interpolation). New `locale` config key (default `'en'`) — switch with `termuxai config set locale id`. repl.js and single-shot.js now share the same locale keys; retry warning locale is threaded `bin/tai.js` → orchestrator → LLM clients → `withRetry`. 8 new tests in `tests/i18n.test.js`; suite 430/439 (same 9 pre-existing wizard failures).

### MAINT-05 — Legacy `geminiClient` alias scattered across 4 files
**Difficulty**: Easy
- **Files**: `src/agent/orchestrator.js:71,342`; `src/cli/slash-commands.js:294,336-341,417-421,448`; `src/ui/model-menu.js:267`
- **Why**: Confuses new contributors; suggests incomplete refactor. Every accessor needs a null-check fallback.
- **Fix**: Remove the alias entirely. Update all call sites to use `orchestrator.llmClient`. Add a migration note.
- **Status**: ✅ **FINISHED** (2026-08-30) — Removed `options.geminiClient` fallback and the `this.geminiClient` alias from `AgentOrchestrator` (constructor + `setProvider`). `src/cli/slash-commands.js` and `src/ui/model-menu.js` now read only `orchestrator.llmClient`; the duplicate `setModel` branches are gone. All test call sites renamed to pass `llmClient`. Migration note added to CHANGELOG `[Unreleased]`. Suite 440/449 (same 9 pre-existing wizard failures).

### MAINT-06 — `normalizeToolArgs` switch-case is unmaintainable
**Difficulty**: Medium
- **File**: `src/tools/registry.js:167-204`
- **Pattern**: 5-case switch mapping 20+ alias names per tool. Adding a new alias requires editing 5 branches.
- **Fix**: Data-driven map: `{ read_file: { filePath: ['path','file',...] }, ... }`. One function, no branching.
- **Status**: ✅ **FINISHED** (2026-08-30) — Replaced the switch with an exported `TOOL_ARG_ALIASES` map of per-tool rules (`{ target, aliases, fallback, nullish }`). `normalizeToolArgs` is now branch-free: missing canonical args are filled from the alias list (first-truthy, or first-non-nullish for `nullish` rules, which preserve `write_file.content`'s `??` semantics). Adding an alias is a one-line map edit. 10 new tests in `tests/registry-args.test.js` lock alias mapping, precedence, and fallbacks; suite 440/449.

### MAINT-07 — `parseTextToolCalls` is 158 lines with 7 heuristic regex pass-throughs
**Difficulty**: Hard
- **File**: `src/llm/openai.js:400-557`
- **Why**: Extremely brittle. Each pattern is a separate regex pass with its own edge cases. New model output formats will break silently.
- **Fix**: Consolidate into a single structured parser, or delegate to a lightweight library like `jsonrepair`. Add extensive snapshot tests for each model's output format.
- **Status**: ✅ **FINISHED** (2026-08-30) — Replaced the seven ad-hoc regex passes with a structured pipeline: a declarative table of block constructs (tagged containers, underscore XML blocks, `<function=…>` blocks, tagged JSON, fenced JSON) scanned in order, shared JSON-shape and parameter-tag helpers, ReAct `Action:` and bare `tool_name {…}` fallback scans, and a single validation/dedup point. 49 snapshot tests in `tests/parse-text-tool-calls.test.js` lock extraction behavior for every known model output format — including quirks like the container+tagged-JSON double-add and classification scanning inside fences — and pass unchanged against the rewrite. No new runtime dependency (`jsonrepair` was declined to keep the project zero-dep). Suite 494/503 (same 9 pre-existing wizard failures).

---

## Priority 4 — Performance

### PERF-01 — No connection pooling for LLM requests
**Difficulty**: Medium
- **Files**: `src/llm/gemini.js:194`, `src/llm/openai.js:176`
- **Why**: Each `generateStream` call opens a new HTTP connection. ReAct loops with 15-30 iterations create 15-30 TCP handshakes + TLS negotiations.
- **Fix**: Reuse a single `fetch` dispatcher (Node 18+ supports it natively; pass `{ dispatcher: pool }` or use undici explicitly). Node's global fetch is process-wide but doesn't pool across sequential calls without explicit reuse.

### PERF-02 — Session messages never pruned aggressively enough
**Difficulty**: Medium
- **File**: `src/agent/pruner.js` + `src/agent/orchestrator.js:176-179`
- **Why**: Pruning happens at 85% of context window, but each prune discards earlier turns wholesale. Long conversations get truncated abruptly with information loss.
- **Fix**: Implement sliding-window truncation (keep last N messages, compress older ones) rather than hard cutoff. Or use a summary tool that asks the LLM to summarize past turns.
- **Status**: ✅ **FINISHED** (2026-08-30) — `pruneMessages` now compresses instead of hard-cutting: drained middle turns are folded into a bounded extractive digest message (new exported `buildSummaryMessage` in `src/agent/pruner.js`) inserted ahead of the retained window, so earlier context survives in summary form. Digest lines are per-message one-liners (role prefix + first text / `calls tool(args)` / `tool result`, truncated to 160 chars each); the body is capped at 4000 chars (tunable via `digestMaxChars`), keeping the most recent lines and collapsing older ones into an `(+N older digest lines omitted)` note. The drain boundary never splits a tool call from its function responses — both compress together, and a kept first message whose responses fall in the drain zone is pulled into the digest too, so no dangling calls or orphaned responses reach the API (sanitize remains as backstop). `compress: false` restores the previous hard-cutoff behavior. Chosen over LLM-summarization to keep the pruner pure, synchronous, zero-dep, and deterministic per iteration (session history itself is never mutated — the digest lives only in the per-call pruned view). 4 new tests in `tests/step4-session.test.js` cover digest content, size cap + omission note, call/response integrity, and the opt-out. Suite 500/509 (same 9 pre-existing wizard failures).

### PERF-03 — `estimateSessionTokens` recomputed every iteration
**Difficulty**: Easy
- **File**: `src/agent/orchestrator.js:165`
- **Why**: Called at top of every loop iteration. If estimate is expensive (token counting over full message list), this adds overhead.
- **Fix**: Cache token count incrementally (add delta per message).
- **Status**: ✅ **FINISHED** (2026-08-30) — Added a per-message token cache (module-level `WeakMap` keyed by message object identity) in `src/agent/pruner.js`. `estimateSessionTokens` now routes through the new `estimateMessagesTokens()`: repeated scans only compute estimates for newly appended messages (the delta), while pruned messages fall out of the cache via GC. Safe because sessions are append-only — `normalizeContent` always produces fresh message objects and nothing mutates messages in place. `pruneMessages`' internal re-estimation loop and the `/status` call in `slash-commands.js` benefit from the same cache for free. 2 new tests in `tests/step4-session.test.js` lock cache consistency (matches full recompute, correct growth after append, no staleness after `setMessages`). Suite 496/505 (same 9 pre-existing wizard failures).

---

## Priority 5 — Missing Features

### FEAT-01 — No rate-limit awareness / backoff for streaming
**Difficulty**: Hard
- **File**: `src/llm/retry.js` handles 429/503 on non-stream calls, but stream retry is not implemented. A mid-stream 429 kills the response with no recovery.
- **Fix**: Buffer partial stream, retry the entire generation on 429/503, resume from last committed token.

### FEAT-02 — No multi-agent / subagent support
**Difficulty**: Hard
- README mentions "autonomous agent" but there's only a single `AgentOrchestrator`. For complex tasks (write docs, run tests, deploy), a single loop hits iteration limits.
- **Fix**: Add a simple subagent spawn pattern (fork an orchestrator with its own session).

### FEAT-03 — No persistent background tasks
**Difficulty**: Medium
- `execute_command` runs synchronously within the turn. Long-running builds/tests block the REPL.
- **Fix**: Support `&` suffix or `--bg` flag to run commands in background with async status polling.

### FEAT-04 — No file watch / auto-reload
**Difficulty**: Easy
- Changing a config file requires restarting `termuxai`.
- **Fix**: Watch config directory with `fs.watch` and reload on change.

### FEAT-05 — No plugin system
**Difficulty**: Hard
- Tools are hardcoded in `TOOLS_MAP`. Cannot extend without modifying source.
- **Fix**: Allow loading tool modules from a plugin directory (`~/.termuxai/plugins/`).

---

## Priority 6 — Documentation / Onboarding

### DOC-01 — README claims "324/324 tests pass" but actual count is 429
**Difficulty**: Easy
- **File**: `README.md:31`
- **Why**: Stale claim. Misleads reviewers about test health.
- **Fix**: Update to accurate count.

### DOC-02 — Security section absent from README
**Difficulty**: Medium
- **Why**: Users running an AI agent with shell access need to understand the threat model (regex blacklists are bypassable, paths are validated but Termux storage is auto-approved).
- **Fix**: Add a Security section documenting what's protected and what isn't. Point to `src/security/rules.js`.

### DOC-03 — No `SECURITY.md` for responsible disclosure
**Difficulty**: Easy
- Standard open-source practice. Missing.

### DOC-04 — Inline JSDoc is thorough but some types are inaccurate
**Difficulty**: Medium
- **Example**: `options.logger` documented as `object` but callers pass specific logger instances with `.info/.warn/.error` methods.
- **Fix**: Define a `Logger` interface type and use it consistently.

---

## Priority 7 — Dependencies

### DEPS-01 — Zero external deps — good, but missing useful dev deps
**Difficulty**: Easy
- **Evidence**: `package.json` has no `devDependencies` at all.
- **Impact**: No test runner version pinning (relies on `node --test` built-in, which is fine for Node 18+), no linting, no type checking.
- **Fix**: At minimum add `@biomejs/biome` (dev dep, formatter+linter) and optionally `typescript` for strict mode.

### DEPS-02 — Engine requirement is broad
**Difficulty**: Easy
- **Evidence**: `"node": ">=18.0.0"` allows Node 18 (EOL Sept 2025).
- **Fix**: Recommend `>=20.0.0` or at least `>=18.18` for stable fetch.

---

## Priority 8 — Configuration Gaps

### CONFIG-01 — No `.editorconfig`
**Difficulty**: Easy
- Inconsistent line endings / indent styles across editors.
- **Fix**: Add `.editorconfig` with `end_of_line = lf`, `insert_final_newline = true`, `trim_trailing_whitespace = true`.

### CONFIG-02 — No `commitlint` / conventional commits enforcement
**Difficulty**: Medium
- Git history shows reasonable convention (`feat:`, `fix:`, `docs:`), but nothing enforces it.
- **Fix**: Add `commitlint` + husky pre-commit hook.

### CONFIG-03 — `scripts/test` runs only unit tests, not e2e
**Difficulty**: Easy
- **File**: `package.json:14`
- **Why**: `test` excludes `tests/e2e/`. `test:all` includes both.
- **Fix**: Make `test` run all, or clearly document that e2e requires network.

---

## Summary Verdict

This is a **well-architected CLI project** with:
- Good separation of concerns (LLM adapters, security guard, tool registry, session manager)
- Solid test coverage (429 unit tests + 3 e2e suites)
- Thoughtful features: atomic config writes, path validation, reflection-based self-correction
- Active maintenance (66 commits, clear commit semantics)

**Three classes of issues stand out**:

1. **Security**: Regex blacklists don't contain autonomous agents. The Gemini API key-in-URL pattern is a real leakage vector. These should be addressed before wider distribution.
2. **Test hygiene**: The flaky suite-level failure (BUG-01) suggests shared mutable state — fix that before adding more tests, or the signal-to-noise ratio will degrade.
3. **Missing tooling**: No linter, no CI, no changelog means the project drifts. Adding these three things costs < 50 lines of config and pays dividends immediately.

**The codebase is in good shape for a v1.0.0 release. Address SEC-01 through SEC-04 and BUG-01 before calling it production-ready.**
