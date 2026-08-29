# Project Improvement Analysis — termuxai

**Generated**: 2026-08-29
**Project**: termuxai — Autonomous AI Agent CLI for Termux
**Stack**: Node.js ESM (pure JS, zero deps), custom ReAct loop, custom ANSI TTY renderer, custom SSE parsers
**Audience**: Termux Android users + Linux/macOS dev environments
**Verdict**: Well-architected v1.0 candidate. Fix P1 (security) + BUG-01 (flaky test) before public release.

---

## Priority 1 — Security / Critical Bugs (must fix)

### SEC-01 — Gemini API key leaked in URL query string
- **File**: `src/llm/gemini.js:91`
- **Pattern**: `...?${streamParam}key=${this.apiKey}`
- **Why**: Keys appear in proxy logs, browser DevTools Network tab, server access logs. OpenAI adapter correctly uses `Authorization: Bearer` header; Gemini does not.
- **Fix**: Use query param only if the provider mandates it (Gemini does), but document the tradeoff. Better: add a config option to route through a proxy that strips keys, or at minimum add a security advisory in README.
- **Status**: ✅ **FIXED** (2026-08-29) — Added `gemini.useHeaderAuth` config flag (default `false`). When enabled, API key is sent via `Authorization: Bearer` header instead of `key=` query param. New `_buildHeaders()` helper centralizes header construction in `src/llm/gemini.js`.

### SEC-02 — Windows `spawn` defaults to `shell: true` silently
- **File**: `src/tools/execute_command.js:48-50`
- **Pattern**: `const shellOption = isWindows ? (process.env.ComSpec || true) : ...`
- **Why**: When `ComSpec` is unset, `shell: true` falls back to `%SystemRoot%\system32\cmd.exe /c`. Any shell metacharacters in `command` get interpreted. The blacklist in `rules.js` is regex-only and trivially bypassable (encoded chars, alternate forms, comment injection `; #`).
- **Fix**: Never default to `true`; require explicit `ComSpec`. Validate command starts with an allowed word char sequence before spawning. Consider whitelisting instead of blacklisting.
- **Status**: ✅ **FIXED** (2026-08-29) — Replaced `shell: true` fallback with explicit `C:\Windows\System32\cmd.exe` when `ComSpec` is unset. Eliminates the silent `cmd.exe /c` path so the shell used is always explicit and inspectable.

### SEC-03 — No sandbox beyond regex blacklist
- **File**: `src/security/rules.js:9-55`
- **Why**: Regex-based command filtering is inherently leaky. An LLM can rephrase `rm -rf /` into equivalent forms that bypass each pattern. Same class of bug exists in many "safe shell" wrappers.
- **Fix**: At minimum, drop privileges (run child under a restricted user), use `--no-preserve-root` check, chroot/jail when possible. Document the limitation clearly in README security section.
- **Status**: 🟡 **PARTIAL FIX** (2026-08-29) — Added defense-in-depth layers in `src/security/rules.js` and `src/security/guard.js`: `HARD_LIMITS` (2000 char cap, null-byte guard), `OBFUSCATION_PATTERNS` (hex escapes, base64-to-shell, eval), `PROTECTED_PATH_PATTERNS` (blocks `/`, `~`, `/etc`, `/boot`, `/var/lib` regardless of verb). Regex blacklist kept as last line. OS-level sandboxing (privilege drop, chroot) still not implemented.

### SEC-04 — Full path traversal allowed for Termux storage
- **File**: `src/security/path-validator.js:53-63`
- **Why**: `isTermuxStoragePath` auto-approves any path inside Android external storage. On a shared device or compromised Termux instance, this expands the safe workspace to the entire SD card.
- **Fix**: Require explicit opt-in via config flag `allowTermuxStorage=true` rather than default-true.
- **Status**: ✅ **FIXED** (2026-08-29) — Flipped `allowTermuxStorage` default to `false`. Guard now reads `security.allowTermuxStorage` from config via `_pathOptions()` and threads it into all `validateSafePath()` calls. Enable with `termuxai config set security.allowTermuxStorage true`.

---

## Priority 2 — Bugs (broken behavior)

### BUG-01 — Flaky test: step5-provider-wizard fails in full suite, passes alone
- **File**: `tests/step5-provider-wizard.test.js`
- **Symptom**: `not ok 26` appears only when all unit tests run together (428 pass, 1 fail). Passes in isolation.
- **Likely cause**: Shared `defaultSessionManager` or `configManager` singleton state mutates across test files. The wizard touches the filesystem at `~/.termuxai/` which persists between tests.
- **Fix**: Wrap each test in its own isolated `ConfigManager(customDir)` and `SessionManager(customDir)`, or clean up temp dirs between tests. Add `--test-reporter=spec` to reproduce locally.

### BUG-02 — Deprecation warnings emitted during normal test runs
- **File**: `src/config/manager.js:652-664`
- **Symptom**: `(node:15048) [TAI_DEPRECATED_GET_PROVIDER_MODELS] DeprecationWarning` printed to stderr in every full-suite run.
- **Why**: Internal tests still call `getProviderModels()`.
- **Fix**: Replace internal usages with `getModelCatalog()`; remove deprecation warning after transition.

### BUG-03 — `loadConfig()` called synchronously on every getter/setter invocation
- **File**: `src/config/manager.js:223,243,281,309,347,401,413,435,483,552,613,689,735,783,800`
- **Pattern**: 16 calls to `loadConfig()` per method chain; each does `fs.readFileSync` + `JSON.parse`. In a busy REPL session or batch of slash commands, this is N disk reads per second.
- **Fix**: Add an in-memory cache with TTL or invalidate-on-write pattern. `loadConfig()` should read once per "transaction", not per property access.

### BUG-04 — Blocking synchronous I/O on hot path
- **Files**: `src/tools/read_file.js:53` (`readFileSync`), `src/tools/list_dir.js:65` (`readdirSync`), `src/tools/patch_file.js:41` (`readFileSync`), `src/security/path-validator.js:99` (`statSync`, `openSync`)
- **Why**: Blocks the event loop. On Termux (single-core ARM, slower disk), a large directory scan or big file read freezes the REPL for seconds.
- **Fix**: Migrate to async `fs.promises` variants. The orchestrator already awaits everything; the bottleneck is internal sync calls.

---

## Priority 3 — Maintainability / Code Quality

### MAINT-01 — No linter, no formatter, no type checker
- **Evidence**: No `eslint.config.*`, no `.prettierrc`, no `tsconfig.json`, no `oxlint`, no `biome`. The repo has 0 lint/format config files.
- **Impact**: Style drift across contributors, silent typos, inconsistent indentation. The project claims "production-grade" but has no quality gates.
- **Fix**: Add Biome (fastest zero-config JS formatter/linter) or ESLint + Prettier. Commit a config. Add pre-commit hook.

### MAINT-02 — No CI/CD
- **Evidence**: No `.github/workflows/` directory. No GitHub Actions, no CI badge.
- **Impact**: Breakages can merge silently. The one existing flaky test likely went unnoticed.
- **Fix**: Add a GitHub Actions workflow that runs `npm test` and `npm run test:e2e` on push/PR.

### MAINT-03 — No changelog
- **Evidence**: No `CHANGELOG.md`. Git history is the only record.
- **Impact**: Users upgrading can't see breaking changes. Releases are opaque.
- **Fix**: Add `changesets` or maintain a manual `CHANGELOG.md` updated per PR.

### MAINT-04 — Language-mixed strings degrade UX for non-Indonesian speakers
- **Files**: `src/cli/repl.js:86,95,103,165,172,188,194,198,200`; `src/cli/provider-wizard.js` (Indonesian prompts); `src/llm/retry.js:188` ("Jaringan sibuk")
- **Why**: ~30 strings are in Indonesian. Non-Indonesian users see inconsistent locale. The project markets globally (README is English).
- **Fix**: Extract all user-facing strings to a locale file (`locales/en.json`, `locales/id.json`) and default to English. Keep Indonesian as an optional locale.

### MAINT-05 — Legacy `geminiClient` alias scattered across 4 files
- **Files**: `src/agent/orchestrator.js:71,342`; `src/cli/slash-commands.js:294,336-341,417-421,448`; `src/ui/model-menu.js:267`
- **Why**: Confuses new contributors; suggests incomplete refactor. Every accessor needs a null-check fallback.
- **Fix**: Remove the alias entirely. Update all call sites to use `orchestrator.llmClient`. Add a migration note.

### MAINT-06 — `normalizeToolArgs` switch-case is unmaintainable
- **File**: `src/tools/registry.js:167-204`
- **Pattern**: 5-case switch mapping 20+ alias names per tool. Adding a new alias requires editing 5 branches.
- **Fix**: Data-driven map: `{ read_file: { filePath: ['path','file',...] }, ... }`. One function, no branching.

### MAINT-07 — `parseTextToolCalls` is 158 lines with 7 heuristic regex pass-throughs
- **File**: `src/llm/openai.js:400-557`
- **Why**: Extremely brittle. Each pattern is a separate regex pass with its own edge cases. New model output formats will break silently.
- **Fix**: Consolidate into a single structured parser, or delegate to a lightweight library like `jsonrepair`. Add extensive snapshot tests for each model's output format.

---

## Priority 4 — Performance

### PERF-01 — No connection pooling for LLM requests
- **Files**: `src/llm/gemini.js:194`, `src/llm/openai.js:176`
- **Why**: Each `generateStream` call opens a new HTTP connection. ReAct loops with 15-30 iterations create 15-30 TCP handshakes + TLS negotiations.
- **Fix**: Reuse a single `fetch` dispatcher (Node 18+ supports it natively; pass `{ dispatcher: pool }` or use undici explicitly). Node's global fetch is process-wide but doesn't pool across sequential calls without explicit reuse.

### PERF-02 — Session messages never pruned aggressively enough
- **File**: `src/agent/pruner.js` + `src/agent/orchestrator.js:176-179`
- **Why**: Pruning happens at 85% of context window, but each prune discards earlier turns wholesale. Long conversations get truncated abruptly with information loss.
- **Fix**: Implement sliding-window truncation (keep last N messages, compress older ones) rather than hard cutoff. Or use a summary tool that asks the LLM to summarize past turns.

### PERF-03 — `estimateSessionTokens` recomputed every iteration
- **File**: `src/agent/orchestrator.js:165`
- **Why**: Called at top of every loop iteration. If estimate is expensive (token counting over full message list), this adds overhead.
- **Fix**: Cache token count incrementally (add delta per message).

---

## Priority 5 — Missing Features

### FEAT-01 — No rate-limit awareness / backoff for streaming
- **File**: `src/llm/retry.js` handles 429/503 on non-stream calls, but stream retry is not implemented. A mid-stream 429 kills the response with no recovery.
- **Fix**: Buffer partial stream, retry the entire generation on 429/503, resume from last committed token.

### FEAT-02 — No multi-agent / subagent support
- README mentions "autonomous agent" but there's only a single `AgentOrchestrator`. For complex tasks (write docs, run tests, deploy), a single loop hits iteration limits.
- **Fix**: Add a simple subagent spawn pattern (fork an orchestrator with its own session).

### FEAT-03 — No persistent background tasks
- `execute_command` runs synchronously within the turn. Long-running builds/tests block the REPL.
- **Fix**: Support `&` suffix or `--bg` flag to run commands in background with async status polling.

### FEAT-04 — No file watch / auto-reload
- Changing a config file requires restarting `termuxai`.
- **Fix**: Watch config directory with `fs.watch` and reload on change.

### FEAT-05 — No plugin system
- Tools are hardcoded in `TOOLS_MAP`. Cannot extend without modifying source.
- **Fix**: Allow loading tool modules from a plugin directory (`~/.termuxai/plugins/`).

---

## Priority 6 — Documentation / Onboarding

### DOC-01 — README claims "324/324 tests pass" but actual count is 429
- **File**: `README.md:31`
- **Why**: Stale claim. Misleads reviewers about test health.
- **Fix**: Update to accurate count.

### DOC-02 — Security section absent from README
- **Why**: Users running an AI agent with shell access need to understand the threat model (regex blacklists are bypassable, paths are validated but Termux storage is auto-approved).
- **Fix**: Add a Security section documenting what's protected and what isn't. Point to `src/security/rules.js`.

### DOC-03 — No `SECURITY.md` for responsible disclosure
- Standard open-source practice. Missing.

### DOC-04 — Inline JSDoc is thorough but some types are inaccurate
- **Example**: `options.logger` documented as `object` but callers pass specific logger instances with `.info/.warn/.error` methods.
- **Fix**: Define a `Logger` interface type and use it consistently.

---

## Priority 7 — Dependencies

### DEPS-01 — Zero external deps — good, but missing useful dev deps
- **Evidence**: `package.json` has no `devDependencies` at all.
- **Impact**: No test runner version pinning (relies on `node --test` built-in, which is fine for Node 18+), no linting, no type checking.
- **Fix**: At minimum add `@biomejs/biome` (dev dep, formatter+linter) and optionally `typescript` for strict mode.

### DEPS-02 — Engine requirement is broad
- **Evidence**: `"node": ">=18.0.0"` allows Node 18 (EOL Sept 2025).
- **Fix**: Recommend `>=20.0.0` or at least `>=18.18` for stable fetch.

---

## Priority 8 — Configuration Gaps

### CONFIG-01 — No `.editorconfig`
- Inconsistent line endings / indent styles across editors.
- **Fix**: Add `.editorconfig` with `end_of_line = lf`, `insert_final_newline = true`, `trim_trailing_whitespace = true`.

### CONFIG-02 — No `commitlint` / conventional commits enforcement
- Git history shows reasonable convention (`feat:`, `fix:`, `docs:`), but nothing enforces it.
- **Fix**: Add `commitlint` + husky pre-commit hook.

### CONFIG-03 — `scripts/test` runs only unit tests, not e2e
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
