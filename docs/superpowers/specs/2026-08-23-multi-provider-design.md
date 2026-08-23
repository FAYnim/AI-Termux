# Multi-Provider LLM Support — Design

**Date:** 2026-08-23
**Status:** Approved (brainstorming complete, awaiting implementation plan)
**Owner:** FAYnim

## Goal

Let `termuxai` talk to OpenAI-compatible endpoints (OpenAI, OpenRouter, Groq, Ollama, LM Studio, …) in addition to the existing Gemini path. Each provider owns its own `apiKey`, `model`, and `baseUrl`, configured through an interactive `provider add` flow and persisted in `config.json`. Auto-promotion keeps every existing config working unchanged.

Non-goals (v1): auto-fallback chains, native Anthropic SDK, Gemini-compat proxies routed through the OpenAI adapter, per-session provider override UI on resume.

## Architecture

### File layout

```
src/llm/
  base.js          NEW   shared interface, timeout/retry helpers
  registry.js      NEW   createLlmClient({provider, model, apiKey, baseUrl})
  openai.js        NEW   OpenAIClient (SSE + tools)
  gemini.js        EDIT  refactored to extend base; no behavior change
  index.js         EDIT  re-export createLlmClient + adapters
  types.js         UNCHANGED
  retry.js         UNCHANGED
  stream-parser.js UNCHANGED
```

### Adapter contract (`base.js`)

```
class BaseLlmClient {
  getModel() / setModel(name)
  getApiKey() / setApiKey(key)
  buildRequestBody({contents, tools, systemInstruction, generationConfig})
  generateStream({contents, tools, systemInstruction, generationConfig,
                  onToken, onFunctionCall, onFinish, signal, timeoutMs})
  generate({...same})
}
```

Both `generate*` methods return `{ text, functionCalls:[{name,args}], finishReason, usage, raw }` — identical to current `GeminiClient`. The orchestrator and session are provider-blind.

### Dispatch (`registry.js`)

```
function createLlmClient({ provider, model, apiKey, baseUrl, logger, signal }) {
  switch (provider) {
    case 'gemini': return new GeminiClient({model, apiKey, baseUrl, logger});
    case 'openai': return new OpenAIClient({model, apiKey, baseUrl, logger});
    default: throw new Error(`Unknown provider: ${provider}`);
  }
}
```

### Orchestrator diff (`src/agent/orchestrator.js`)

- `this.geminiClient` → `this.llmClient`.
- `createGeminiClient(...)` → `createLlmClient({ provider, model, apiKey, logger })` where `provider` comes from `configMgr.get('activeProvider')`.
- New method `setProvider(providerId)` re-creates the client and updates `session.provider` / `session.model`.
- All `generateStream` / `setModel` / `getModel` call sites unchanged.

### Session (`src/agent/session.js`)

- Persist `provider` field alongside `model`.
- On `resume`, `createLlmClient({ provider: session.provider, ... })`.

## Config schema & migration

### New `config.json` shape

```json
{
  "activeProvider": "gemini",
  "providers": {
    "gemini": { "apiKey": "...", "model": "gemini-2.5-flash", "baseUrl": "https://generativelanguage.googleapis.com" },
    "openai": { "apiKey": "...", "model": "gpt-4o-mini",        "baseUrl": "https://api.openai.com/v1" }
  },
  "timeoutMs": 30000,
  "maxContextTokens": 1000000,
  "autoConfirm": false,
  "verbose": false
}
```

### Constants (`src/config/constants.js`)

```js
export const BUILTIN_PROVIDERS = {
  gemini: {
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-2.5-flash',
    envVars: ['GEMINI_API_KEY', 'TERMUXAI_API_KEY', 'T_AI_API_KEY'],
    envBaseUrlVars: [],
    envModelVars: [],
  },
  openai: {
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    envVars: ['OPENAI_API_KEY'],
    envBaseUrlVars: ['OPENAI_BASE_URL'],
    envModelVars: ['OPENAI_MODEL'],
  },
};

export const DEFAULT_ACTIVE_PROVIDER = 'gemini';

export const DEFAULT_CONFIG = {
  activeProvider: DEFAULT_ACTIVE_PROVIDER,
  providers: {},
  timeoutMs: 30000,
  maxContextTokens: 1000000,
  autoConfirm: false,
  verbose: false,
};
```

### Manager changes (`src/config/manager.js`)

1. `loadConfig()` merges `DEFAULT_CONFIG` then runs auto-promotion if needed.
2. Auto-promotion: if `config.providers.gemini` missing AND legacy `config.apiKey` non-empty OR any `envVars` match, synthesize `providers.gemini` from those values, set `activeProvider='gemini'`, persist once.
3. `getProviderConfig(id)` merges `BUILTIN_PROVIDERS[id]` defaults with stored `config.providers[id]` and env vars (stored wins). Env vars resolved at read time, never written to disk.
4. `getApiKey(overrideKey, providerId='gemini')` — env lookup walks `BUILTIN_PROVIDERS[providerId].envVars`, then config entry, then CLI override.
5. `setProviderField(providerId, field, value)` and `removeProvider(providerId)` helpers.
6. Legacy `getApiKey(overrideKey)` (no provider arg) returns the active provider's key.

### Backward compatibility

- Any existing `config.json` loads unchanged on first run after upgrade.
- Auto-promotion happens silently and writes the new shape once.
- `config get apiKey` still returns the Gemini key (resolves active provider).
- Legacy env vars (`GEMINI_API_KEY`, `TERMUXAI_API_KEY`, `T_AI_API_KEY`) still work without any config.
- Built-in providers (`gemini`, `openai`) cannot be `remove`d, only their stored fields cleared.

### Env vars (resolution priority: CLI flag → env → config)

| Provider | Key env vars | Base URL env vars | Model env vars |
|---|---|---|---|
| `gemini` | `GEMINI_API_KEY`, `TERMUXAI_API_KEY`, `T_AI_API_KEY` | — | — |
| `openai` | `OPENAI_API_KEY` | `OPENAI_BASE_URL` | `OPENAI_MODEL` |

## OpenAI adapter translation

| Gemini shape | OpenAI Chat Completions |
|---|---|
| `{role:'user', parts:[{text}]}` | `{role:'user', content:text}` |
| `{role:'model', parts:[{text}]}` | `{role:'assistant', content}` (omit when only `function_call`) |
| `{role:'model', parts:[{functionCall}]}` | `{role:'assistant', tool_calls:[{id, type:'function', function:{name, arguments:JSON.stringify(args)}}]}` |
| `{role:'function', parts:[{functionResponse}]}` | `{role:'tool', tool_call_id, content:JSON.stringify(response)}` |
| `systemInstruction.parts[0].text` | top-level `messages` with `{role:'system', content}` |
| `tools:[{functionDeclarations:[...]}]` | flat `tools:[{type:'function', function:{name,description,parameters}}]` |
| `streamGenerateContent?alt=sse` | `POST /chat/completions` with `"stream":true`, parse `data: {...}\n\n` SSE chunks |
| `usageMetadata.{prompt,candidates,total}TokenCount` | `usage.{prompt,completion,total}_tokens` |
| SSE `candidates[0].content.parts[0].text` | chunk `choices[0].delta.content` (string) |
| SSE `candidates[0].content.parts[0].functionCall` | chunk `choices[0].delta.tool_calls[]` (incremental arg fragments joined by index) |
| `finishReason:'STOP'/'MAX_TOKENS'/...` | `choices[0].finish_reason` → mapped: `stop→STOP`, `length→MAX_TOKENS`, `tool_calls→STOP` |

### Tool-call streaming details

OpenAI emits `tool_calls` across multiple chunks: index 0 name, then index 0 partial args, then index 1 name, etc. The adapter buffers per index, joins argument strings, emits a single `onFunctionCall({name, args})` once `finish_reason !== null`. Empty content with no tool calls yields `text:''`, `functionCalls:[]`, `finishReason:'STOP'`.

### Error mapping

Non-200 responses throw `OpenAI API Error (<status>): <message>` with `error.status` / `error.statusCode` / `error.details` attached — same shape as `GeminiClient` errors, so existing retry logic and error UX work unchanged.

### Timeout & retry

`withRetry` + `_createTimeoutSignal` move to `base.js` and are reused unchanged by `OpenAIClient`.

## CLI surface

### Subcommands

```
termuxai provider list                  # table: id | model | baseUrl | key (masked)
termuxai provider use <id>              # sets activeProvider, persists
termuxai provider add <id>              # interactive: baseUrl? model? apiKey? (echo-masked)
termuxai provider remove <id>           # refuses built-ins
termuxai provider show [id]             # dump one entry as JSON
```

`provider add` accepts `--api-key`, `--model`, `--base-url` flags; prompts only for missing fields. Built-ins (`gemini`, `openai`) cannot be `remove`d; their stored fields can be cleared via `provider add <id>` (passing `--api-key ""`, `--model ""`, `--base-url ""`) or by editing `config.json`.

### Global flags

```
--provider <id>      one-shot provider override, does not persist
--model <name>       override model within active or --provider
--api-key, -k <key>  override API key only
```

Priority: `--provider` > `config.activeProvider`; `--model` > stored/env model; `--api-key` > env > config.

### REPL slash commands

```
/provider [id]      show active, or switch + persist + rebuild llmClient
/provider list      same as `provider list`
/model [name]       unchanged: scoped to active provider
```

`/provider <id>` calls `orchestrator.setProvider(id)` which:
1. Updates `config.activeProvider`.
2. Re-creates `llmClient` via `createLlmClient`.
3. Updates `session.provider` and `session.model` (does not clear history).

### First-run auto-detect

When no built-in provider has any key (config OR env) on `termuxai` start, show a one-shot prompt:

```
┌─ Setup ──────────────────────────────────┐
│ No API key configured.                  │
│ 1) Use Gemini  (set GEMINI_API_KEY)     │
│ 2) Use OpenAI  (set OPENAI_API_KEY)     │
│ 3) Configure now                         │
│ 4) Exit                                  │
└──────────────────────────────────────────┘
Select:
```

- 1 / 2: prints instructions and exits.
- 3: runs `provider add` interactively.
- 4: exits cleanly.
- If Gemini key is present but OpenAI is not, no prompt — silently use Gemini.

### Error messages

Active-provider-aware: `"OpenAI API key is not configured. Set OPENAI_API_KEY or run 'termuxai provider add openai'."`

## Tests

### Unit tests

| File | Cases |
|---|---|
| `step1-providers-config.test.js` | auto-promote legacy → providers; `setProviderField`; `getProviderConfig` env precedence; per-provider `getApiKey`; `removeProvider` refuses built-ins. |
| `step3-openai-adapter.test.js` | non-stream text; stream text deltas; tool_calls across multiple chunks assembled; mixed text + tool_calls; `finish_reason` mapping (`stop`, `length`, `tool_calls`); non-200 → typed error; empty `choices`. |
| `step3-registry.test.js` | dispatch to `OpenAIClient`/`GeminiClient`; unknown provider throws. |
| `step3-backward-compat.test.js` | legacy `config.json` loads without throwing; `activeProvider === 'gemini'`; providers block populated. |
| Extend `step3-stream.test.js` | registry end-to-end against fake OpenAI SSE. |
| `step1-cli-provider.test.js` | `provider list` shows built-ins; `provider use openai` persists; `provider add` with flags writes entry. |

### Manual e2e

- Extend `scripts/test-e2e.js` with an OpenAI smoke run gated on `OPENAI_E2E_KEY`. Skipped silently if missing.

### Edge cases handled in code

- `tool_calls` with `arguments: ""` → treated as `{}`.
- SSE chunk split mid-UTF-8 → existing `stream-parser.js` already handles.
- Active provider key missing at request time → targeted error, no silent fallback.
- `--provider openai --model gpt-4o` → both flags compose.
- `resume <id>` whose session used `openai` but key is now missing → error on resume, not silent switch.

## Documentation

- README: new "Providers" section with OpenAI setup example; "Providers" subsection under CLI Reference; auto-promotion note under "Configuration".
- `--help` lists `provider *` subcommands.
- `bin/tai.js` help text updated.

## Open questions for implementation

None — brainstorming locked the design. Implementation plan to follow via `writing-plans` skill.
