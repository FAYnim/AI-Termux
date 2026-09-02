# CLI Rename: `termuxai` → `faycli` (FAY CLI)

Date: 2026-09-01
Status: Approved

## Problem
CLI currently branded `termuxai`. User wants full rebrand to **FAY CLI**. Binary name `faycli`, npm package `faycli`, config dir `~/.faycli`. No backward-compat alias for the old binary.

## Scope: Full rename
Display strings, binary/package name, internal constants, env vars, config keys, config dir, docs, tests, scripts. All occurrences.

## Decisions
- Binary name: `faycli` (no `termuxai` alias/symlink)
- npm package name: `faycli`
- Config dir: `~/.faycli`, with one-time auto-migration from `~/.termuxai` if present (copy, not move — implicit backup; old dir removed manually by user)
- `TERMUXAI_CONFIG_DIR` env var → `FAYCLI_CONFIG_DIR`
- No `termuxai` backward-compat entry in `package.json` bin

## Changes

### 1. Binary & Package
- `package.json`: `name` → `faycli`; `bin` → `{ "faycli": "./bin/tai.js" }`; remove `termuxai` bin entry
- `install.sh`: install binary as `faycli`

### 2. Internal Constants & Env Vars
- `src/config/constants.js`: `APP_NAME` `'termuxai'` → `'faycli'`; `DEFAULT_CONFIG_DIR_NAME` `'.termuxai'` → `'.faycli'`
- `TERMUXAI_CONFIG_DIR` → `FAYCLI_CONFIG_DIR` in `src/config/manager.js` and references

### 3. Config Directory Migration
- Default dir `~/.faycli`
- In `manager.js`: if `~/.faycli` missing but `~/.termuxai` exists → copy contents to `~/.faycli`, then use it. One-time.
- Update legacy fallback logic in `src/config/manager.js` (currently checks `~/.t-ai` and `~/.termuxai`)
- `.gitignore`: `.faycli/`; remove `.termuxai/`

### 4. User-Facing Strings
- `bin/tai.js`: all `termuxai` → `faycli` (help/usage/error strings)
- `src/cli/*`: error/usage strings
- `src/agent/system-prompt.js`: "You are termuxai" → "You are faycli"
- `src/llm/gemini.js`, `src/llm/openai.js`: error message references
- `README.md`, `CHANGELOG.md`, docs: all references
- Header comments: `Termux AI CLI (termuxai)` → `FAY CLI (faycli)` in `bin/tai.js`, `src/index.js`, `src/config/constants.js`, `scripts/*`

### 5. Tests & Scripts
- All test expectations containing `termuxai` → `faycli`
- `scripts/benchmark.js`, `scripts/test-e2e.js`: rename
- Add migration test: `~/.termuxai` → `~/.faycli` copy path

## Backward Compatibility
- Binary `termuxai`: gone. Users reinstall via `faycli`.
- User data in `~/.termuxai`: preserved via one-time auto-migration to `~/.faycli`.

## Verification
1. `npm test` passes
2. `./bin/tai.js --help` shows `faycli`
3. `npm pack` → package `faycli`
4. Fresh machine: first run creates `~/.faycli`
5. Machine with existing `~/.termuxai`: first run auto-migrates, data intact
