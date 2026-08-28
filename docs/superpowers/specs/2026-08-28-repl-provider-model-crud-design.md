# REPL Provider & Model CRUD — Design Spec

**Date:** 2026-08-28  
**Branch:** `feat/multi-model-phase1` (target: next feature branch)  
**Status:** Approved — ready for implementation planning

---

## Problem

Saat ini, menambah provider baru (Groq, DeepSeek, Ollama, dll.) hanya bisa dilakukan lewat CLI non-interaktif (`tai provider add <id> --api-key ... --base-url ...`). Jika user sedang di dalam REPL dan ingin mencoba provider baru, mereka harus:

1. Keluar dari REPL (`/exit`)
2. Jalankan satu atau lebih `tai provider add ...` flags
3. Masuk kembali ke REPL (`termuxai`)

Ini terutama menyakitkan di Termux Android — layar kecil, mengetik flags panjang satu baris lebih susah. Model CRUD (`--add`, `--remove`, `--clear`) punya masalah serupa.

---

## Scope

Fitur ini menambahkan **full CRUD provider dan model** ke dalam REPL lewat slash commands:

| Operasi | Sebelum | Sesudah |
|---|---|---|
| Tambah provider baru | Harus keluar REPL | `/provider add` (wizard) |
| Hapus provider | Harus keluar REPL | `/provider remove <id>` |
| Lihat config provider | Harus keluar REPL | `/provider show [id]` |
| Tambah model ke katalog | Harus keluar REPL | `/model add <name>` |
| Hapus model dari katalog | Harus keluar REPL | `/model remove <name>` |
| Reset katalog model | Harus keluar REPL | `/model clear` |

Fitur yang sudah ada **tidak berubah** — `/provider list`, `/provider <id>` (switch), `/model`, `/model <name>` tetap berjalan seperti sekarang.

---

## Slash Command Interface

### Provider commands (baru)

```
/provider add              Buka wizard interaktif untuk menambah provider baru
/provider add <id>         Wizard dengan provider ID sudah pre-filled
/provider remove <id>      Hapus provider dari config (konfirmasi jika provider aktif)
/provider show [id]        Tampilkan config provider sebagai formatted box (default: active provider)
```

### Model commands (baru)

```
/model add <name[,name2,...]>            Tambah model ke katalog provider aktif
/model add <name> --provider <id>        Tambah model ke provider tertentu
/model remove <name>                     Hapus model dari katalog provider aktif
/model remove <name> --provider <id>     Hapus model dari provider tertentu
/model clear                             Reset katalog ke builtin defaults (provider aktif)
/model clear --provider <id>             Reset katalog provider tertentu
```

### Provider commands yang sudah ada (tidak berubah)

```
/provider                  Tampilkan provider aktif
/provider list             Daftar semua provider yang dikonfigurasi
/provider <id>             Switch ke provider (persist)
```

### Model commands yang sudah ada (tidak berubah)

```
/model                     Interactive picker (TTY) atau static box (non-TTY)
/model <name>              Switch active model
```

### Update SLASH_COMMANDS_HELP

Entri baru yang ditambahkan ke `SLASH_COMMANDS_HELP` di `slash-commands.js`:

```js
{ cmd: '/provider add [id]',        desc: 'Add a new provider via interactive wizard' },
{ cmd: '/provider remove <id>',     desc: 'Remove a configured provider' },
{ cmd: '/provider show [id]',       desc: 'Show provider config details' },
{ cmd: '/model add <name[,...]>',   desc: 'Add model(s) to provider catalog' },
{ cmd: '/model remove <name>',      desc: 'Remove a model from provider catalog' },
{ cmd: '/model clear',              desc: 'Reset provider catalog to builtin defaults' },
```

---

## Provider Add Wizard — Flow Detail

### Overview

Wizard berjalan secara sequential di dalam REPL menggunakan `readline.question()` (Node.js built-in, zero new dependencies). Tiap step bisa dicancel dengan Ctrl+C — tidak ada yang tersimpan sampai wizard selesai dan user konfirmasi.

### Step sequence

```
Step 1 — Provider ID
  Prompt: "Provider ID (e.g. groq, deepseek, ollama): "
  Validasi: non-empty string, strip whitespace
  Jika ID sudah ada di config → tanya: "Provider \"<id>\" already exists. Overwrite? [y/N]: "
  Jika user jawab N (atau Enter) → kembali ke Step 1

Step 2 — Adapter
  Prompt: "Adapter [openai/gemini] (default: openai): "
  Validasi: harus 'openai' atau 'gemini' (case-insensitive), atau Enter → default 'openai'
  Jika input tidak valid → tampilkan error, tanya ulang

Step 3 — Base URL
  [SKIP otomatis jika adapter = 'gemini' — step ini tidak ditampilkan sama sekali]
  Prompt: "Base URL (e.g. https://api.groq.com/openai/v1, Enter for OpenAI default): "
  Enter → simpan string kosong di config (OpenAIClient akan gunakan defaultBaseUrl-nya sendiri)
  URL diisi → simpan URL yang diberikan

Step 4 — API Key  [smart validation]
  Lihat tabel validasi di bawah
  Jika wajib dan kosong → tampilkan error, tanya ulang

Step 5 — Default Model
  Prompt: "Default model (optional, Enter to skip): "
  Enter → model tidak diset (provider akan gunakan defaultModel dari adapter)
  Nilai yang diset: string nama model atau null

Post-save prompt:
  "✔ Provider \"<id>\" saved."
  "  Switch to <id> now? [Y/n]: "
  Y atau Enter → set activeProvider + update orchestrator
  N → selesai tanpa switch
```

### Smart validation — API Key (Step 4)

| Kondisi | Behavior API Key |
|---|---|
| adapter = `gemini` | **Wajib** — tolak Enter kosong, tampilkan error, tanya ulang |
| adapter = `openai`, base-url mengandung `localhost` atau `127.0.0.1` | **Opsional** — Enter kosong diterima (Ollama use case) |
| adapter = `openai`, base-url adalah default OpenAI (`api.openai.com`) | **Wajib** |
| adapter = `openai`, base-url lainnya (cloud: groq, openrouter, deepseek, dll.) | **Wajib** |

### Smart validation — Base URL (Step 3)

| Kondisi | Behavior |
|---|---|
| adapter = `gemini` | Step 3 **tidak ditampilkan** — GeminiClient punya default URL yang fixed, tidak perlu input user |
| adapter = `openai`, Enter kosong | Simpan string kosong — OpenAIClient pakai `defaultBaseUrl` miliknya (`https://api.openai.com/v1`) |
| adapter = `openai`, URL diisi | Simpan URL yang diberikan ke `config.baseUrl` |

### Cancellation & error handling

- **Ctrl+C di tengah wizard** → tulis `\n⚠ Provider add cancelled.\n`, return `{ cancelled: true }`, tidak ada yang tersimpan ke config.
- **Input kosong pada field wajib** → tampilkan pesan error inline (e.g., `⚠ API key is required for gemini.`) dan tanya ulang field yang sama — wizard tidak exit.
- **Provider ID sudah ada** → konfirmasi overwrite sebelum melanjutkan wizard. Jika user tolak overwrite, tanya ID baru.
- **Orchestrator tidak tersedia** saat switch-now → config tetap tersimpan, tampilkan pesan informasional `ℹ Restart REPL to apply provider switch.`

---

## Architecture

### File baru

#### `src/cli/provider-wizard.js`

Single-responsibility: menjalankan wizard interaktif untuk menambah provider. Tidak menyimpan ke config sendiri — returns hasil ke caller.

**Export publik:**

```js
/**
 * Runs the interactive /provider add wizard.
 * @param {object} ctx
 * @param {import('../config/manager.js').ConfigManager} ctx.configMgr
 * @param {NodeJS.WritableStream} ctx.stream   - output stream (default: process.stdout)
 * @param {NodeJS.ReadableStream} ctx.input    - input stream (default: process.stdin)
 * @returns {Promise<
 *   { cancelled: true } |
 *   { cancelled: false, providerId: string, config: ProviderConfig, switchNow: boolean }
 * >}
 */
export async function runProviderAddWizard(ctx = {})
```

**Internal helpers (tidak di-export):**

```
askProviderId(rl, configMgr, stream)
askAdapter(rl, stream)
askBaseUrl(rl, adapter, stream)
askApiKey(rl, adapter, baseUrl, stream)
askDefaultModel(rl, stream)
askSwitchNow(rl, providerId, stream)
isLocalUrl(url)           → boolean, cek localhost/127.0.0.1
isApiKeyRequired(adapter, baseUrl) → boolean
```

Dependencies: `node:readline` (built-in), `../utils/ansi.js`, `../config/constants.js` (BUILTIN_PROVIDERS untuk validasi adapter).

---

### File yang dimodifikasi

#### `src/cli/slash-commands.js`

**Import baru:**
```js
import { runProviderAddWizard } from './provider-wizard.js';
import { addModelsCli, removeModelCli, clearModelsCli } from './model-commands.js';
```

**Case `provider` — ditambah routing:**

```
'add'    → runProviderAddWizard() → save config → optional switch orchestrator
'remove' → konfirmasi jika active provider → configMgr.removeProvider(id)
'show'   → configMgr.getProviderConfig(id) → renderBox formatted output
```

**Case `model` — ditambah subcommand parsing:**

Parse `args` untuk deteksi subcommand `add`, `remove`, `clear` dan flag `--provider`:

```
args[0] = 'add'    → addModelsCli({ configMgr, models: args[1], providerOverride })
args[0] = 'remove' → removeModelCli({ configMgr, models: args[1], providerOverride })
args[0] = 'clear'  → clearModelsCli({ configMgr, providerOverride })
```

Jika `args[0]` bukan subcommand yang dikenal → fallback ke behavior `/model` existing (backward compatible).

**`SLASH_COMMANDS_HELP`** — 6 entri baru (lihat bagian Slash Command Interface).

---

### File yang tidak disentuh

| File | Alasan |
|---|---|
| `src/config/manager.js` | Sudah punya semua API: `loadConfig`, `saveConfig`, `removeProvider`, `getProviderConfig`, `set`, `setProviderField` |
| `src/cli/model-commands.js` | Reuse `addModelsCli`, `removeModelCli`, `clearModelsCli` as-is |
| `src/cli/repl.js` | Wizard berjalan di dalam slash command handler — REPL loop tidak perlu tahu |
| `bin/tai.js` | CLI provider/model commands tidak berubah |
| `src/config/constants.js` | Tidak ada provider builtin baru |

---

## Data Flow

### `/provider add`

```
User types: /provider add
       │
       ▼
slash-commands.js
  case 'provider' → sub 'add'
  calls runProviderAddWizard({ configMgr, stream, input })
       │
       ▼
provider-wizard.js
  readline.question() × 5 steps
  returns {
    cancelled: false,
    providerId: 'groq',
    config: { adapter: 'openai', baseUrl: '...', apiKey: '...', model: 'llama-3.3-70b' },
    switchNow: true
  }
       │
       ▼
slash-commands.js
  cfg = configMgr.loadConfig()
  cfg.providers[providerId] = config
  configMgr.saveConfig(cfg)
  if switchNow:
    configMgr.set('activeProvider', providerId)
    orchestrator.setProvider(providerId, { apiKey, model, baseUrl })
  stream.write('✔ Provider "groq" saved' + [' and activated.' | '.'])
```

### `/model add gpt-4-turbo`

```
User types: /model add gpt-4-turbo
       │
       ▼
slash-commands.js
  case 'model' → args[0] = 'add'
  parse: modelName = 'gpt-4-turbo', providerOverride = null
  calls addModelsCli({ configMgr, models: 'gpt-4-turbo', providerOverride: null })
       │
       ▼
model-commands.js → addModelsCli()
  returns { exitCode: 0, output: '✔ Added 1 model(s) to gemini:...' }
       │
       ▼
slash-commands.js
  stream.write(result.output)
```

### `/provider remove groq`

```
User types: /provider remove groq
       │
       ▼
slash-commands.js
  case 'provider' → sub 'remove'
  cek: apakah 'groq' adalah activeProvider?
    Ya → "⚠ 'groq' is the active provider. Remove anyway? [y/N]: "
    Jika N → return, tidak hapus
  configMgr.removeProvider('groq')
  stream.write('✔ Provider "groq" removed.')
```

---

## Testing Plan

### `tests/step5-provider-wizard.test.js` (baru)

Unit tests untuk `provider-wizard.js` dengan mock `readline.question`:

- Happy path: gemini adapter (skip base URL, wajib API key)
- Happy path: openai cloud adapter (wajib base URL + API key)
- Happy path: ollama adapter (localhost URL, opsional API key)
- Happy path: switchNow = Y → returns `switchNow: true`
- Happy path: switchNow = N → returns `switchNow: false`
- Cancellation via Ctrl+C di tiap step → returns `{ cancelled: true }`
- Provider ID sudah ada, user confirm overwrite (Y)
- Provider ID sudah ada, user tolak overwrite (N) → minta ID baru
- Field wajib kosong → error inline, tanya ulang (bukan exit)
- Invalid adapter input → error inline, tanya ulang

### `tests/step5-slash-model-crud.test.js` (baru)

Unit tests untuk model CRUD melalui `executeSlashCommand()`:

- `/model add gpt-4-turbo` → memanggil `addModelsCli`, output ✔
- `/model add a,b,c --provider openai` → parse multi-model + provider flag
- `/model remove gpt-3.5-turbo` → memanggil `removeModelCli`
- `/model remove active-model` → output error (active model tidak bisa dihapus)
- `/model clear` → memanggil `clearModelsCli`
- `/model clear --provider openai` → provider override
- `/model` (tanpa args) → behavior existing tidak berubah (backward compat)
- `/model somename` (tanpa subcommand) → switch model, tidak diinterpretasi sebagai subcommand

### Modifikasi `tests/step5-slash-commands.test.js` (existing)

Tambah test cases:

- `/provider add` → cancel (Ctrl+C) → tidak ada yang tersimpan
- `/provider remove groq` → groq bukan active provider → hapus langsung
- `/provider remove groq` → groq adalah active provider → tampilkan konfirmasi
- `/provider show groq` → output formatted box
- `/provider show` (tanpa arg) → output active provider config

---

## Non-Goals (Out of Scope)

- Wizard untuk **edit** provider yang sudah ada — user bisa `/provider remove` lalu `/provider add` ulang, atau gunakan `tai provider add <id>` (overwrite).
- Validasi konektivitas (ping API endpoint) di dalam wizard — terlalu lambat dan perlu network.
- `/provider add` untuk menambah builtin provider (gemini, openai) dengan konfigurasi berbeda — sudah bisa, tapi overwrite builtin defaults bukan use case utama.
- Autocomplete nama model saat `/model add` — tidak ada sumber data yang reliable untuk ini tanpa network call.
