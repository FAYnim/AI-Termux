# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Biome linter/formatter (`npm run lint`, `npm run lint:fix`, `npm run format`) with a pre-commit hook under `.githooks/` (MAINT-01).
- GitHub Actions CI running lint and unit tests on Node 20 and 22 (MAINT-02).
- `CHANGELOG.md` (this file), maintained manually per PR (MAINT-03).

### Changed

- Codebase formatted and lint-cleaned with Biome across `src/`, `tests/`, `scripts/`, and `bin/`.

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
