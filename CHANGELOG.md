# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Biome linter/formatter (`npm run lint`, `npm run lint:fix`, `npm run format`) with a pre-commit hook under `.githooks/` (MAINT-01).
- GitHub Actions CI running lint and unit tests on Node 20 and 22 (MAINT-02).
- `CHANGELOG.md` (this file), maintained manually per PR (MAINT-03).
- i18n layer: `locales/en.json` + `locales/id.json` with a zero-dep loader in `src/i18n/index.js`; new `locale` config key (MAINT-04).
- Data-driven `TOOL_ARG_ALIASES` map in `src/tools/registry.js` backing a branch-free `normalizeToolArgs`; adding a tool-argument alias is now a one-line map edit (MAINT-06).
- `tests/registry-args.test.js` covering alias mapping, precedence, fallbacks, and nullish-vs-falsy semantics (MAINT-06).
- 49 snapshot tests in `tests/parse-text-tool-calls.test.js` locking `parseTextToolCalls` extraction behavior for every known model output format: tagged `<tool_calls>`/`<tool_call>` containers and JSON, `<tool_call><_action>`/`<_function_call>` XML blocks, `<function=name>` parameter blocks, fenced JSON, ReAct `Action:` lines, bare `tool_name {…}` pairs, `<think>` stripping, classification fallback, ordering, and dedup (MAINT-07).

### Changed

- `parseTextToolCalls` in `src/llm/openai.js` consolidated from seven ad-hoc regex passes into a structured pipeline: a declarative table of block constructs scanned in order, shared JSON-shape and parameter-tag helpers, and a single validation/dedup point. Extraction behavior is unchanged — the snapshot suite passes identically before and after the rewrite (MAINT-07).

- Codebase formatted and lint-cleaned with Biome across `src/`, `tests/`, `scripts/`, and `bin/`.
- **MAINT-04**: User-facing strings are now localized, default **English**. Indonesian REPL/spinner/retry messages are opt-in via `termuxai config set locale id`. Existing users who relied on the Indonesian defaults will see English after upgrading.
- **MAINT-05 (breaking for embedders)**: Removed the legacy `geminiClient` alias. Pass `llmClient` instead of `geminiClient` when constructing `AgentOrchestrator`, and read `orchestrator.llmClient` instead of `orchestrator.geminiClient`. The CLI-facing behavior is unchanged.

### Fixed

- **Gemini thought signatures**: Gemini 3+ models (e.g. `gemini-3.5-flash`) attach a `thoughtSignature` to function call parts and reject the next request with 400 when replayed history omits it. The signature is now captured during stream/non-stream extraction, stored in session history, and echoed back on subsequent turns. Tool-calling loops on Gemini 3 models no longer fail at turn 2.

## [1.0.0] - 2026-08-30

### Security

- **SEC-01**: Added `gemini.useHeaderAuth` config flag so the Gemini API key can be sent via `Authorization: Bearer` header instead of the `key=` URL query param (`src/llm/gemini.js`).
- **SEC-02**: Windows `spawn` no longer silently falls back to `shell: true`; the shell is now always explicit (`src/tools/execute_command.js`).
- **SEC-03** (partial): Defense-in-depth hardening in `src/security/rules.js` and `src/security/guard.js` — `HARD_LIMITS`, obfuscation patterns, and protected-path blocks. Regex blacklist kept as last line.
- **SEC-04**: `allowTermuxStorage` now defaults to `false`; full SD-card access requires explicit opt-in (`src/security/path-validator.js`).

### Fixed

- **BUG-01**: Per-pull `AnswerStream` replaces the timing-coupled answer feeder; the 10 previously cancelled provider-wizard tests now pass deterministically.
- **BUG-02**: Removed the `TAI_DEPRECATED_GET_PROVIDER_MODELS` warning; `getProviderModels()` is a plain delegation to `getModelCatalog()`.
- **BUG-03**: `ConfigManager` now caches `loadConfig()` per config path with invalidate-on-write instead of re-reading the file on every access.
- **BUG-04**: `read_file`, `list_dir`, and `patch_file` migrated to `node:fs/promises`, unblocking the event loop on the tool hot path.

[Unreleased]: https://github.com/FAYnim/AI-Termux/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/FAYnim/AI-Termux/releases/tag/v1.0.0
