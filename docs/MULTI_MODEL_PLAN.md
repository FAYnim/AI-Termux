# Plan: Multi-Model Support per Provider & Enhanced `/model` Command

**Issue:** Saat ini command `/model` hanya menampilkan model aktif, tanpa daftar model yang tersedia per provider.
**Goal:** Setiap provider bisa memiliki banyak model, dan UI dapat menampilkan/switch di antaranya.

**Last updated:** 2026-08-27 — Phase 1, 2, 3 selesai (semua 263/263 tests pass).

---

## Status Saat Ini (Current State)

### Data Storage Locations
| Item | Lokasi |
|------|--------|
| Config utama | `~/.t-ai/config.json` |
| Session files | `~/.t-ai/sessions/*.json` |
| Constants | `src/config/constants.js` |
| Slash commands | `src/cli/slash-commands.js` |
| Config manager | `src/config/manager.js` |

### Masalah Ditemukan
- [x] **1.** `SUPPORTED_MODELS` di `constants.js` hanya berisi Gemini models (hardcoded, tidak dinamis per provider)
- [x] **2.** `BUILTIN_PROVIDERS` hanya menyimpan default model tunggal, bukan array
- [x] **3.** `/model` slash command hanya show current + set new value, tanpa list *(belum di-fix, menunggu phase 1.3)*
- [x] **4.** Config structure belum punya field `models[]` per provider *(field sudah ada di builtin; auto-populate untuk user config juga sudah)*

---

## Rencana Implementasi (3 Phases)

### Phase 1: Quick Win — Schema + Display List

#### 1.1 Update `src/config/constants.js`
- [x] Tambah field `models` ke builtin provider **gemini** (5 model)
- [x] Tambah field `models` ke builtin provider **openai** (4 model)
- [x] Validasi isi array konsisten dengan `defaultModel`

**Hasil yang diharapkan:**
```js
export const BUILTIN_PROVIDERS = {
  gemini: {
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-2.5-flash',
    models: [
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-1.5-flash',
      'gemini-1.5-pro',
      'gemini-2.0-flash'
    ],
    envVars: ['GEMINI_API_KEY', 'TERMUXAI_API_KEY', 'T_AI_API_KEY'],
    envBaseUrlVars: [],
    envModelVars: [],
  },
  openai: {
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: [
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4',
      'gpt-3.5-turbo'
    ],
    envVars: ['OPENAI_API_KEY'],
    envBaseUrlVars: ['OPENAI_BASE_URL'],
    envModelVars: ['OPENAI_MODEL'],
  },
};
```

#### 1.2 Update `src/config/manager.js`
- [x] Tambah helper method `getProviderModels(providerId)` di `ConfigManager`
- [x] Method merge: `defaultModel` + `stored.models` + `builtin.models`
- [x] Dedupe hasil
- [x] Trim string kosong & filter non-string

**Implementasi:**
```js
/**
 * Get available models for a provider
 * @param {string} providerId
 * @returns {string[]}
 */
getProviderModels(providerId) {
  const builtin = BUILTIN_PROVIDERS[providerId];
  const config = this.loadConfig();
  const stored = config.providers?.[providerId] || {};

  const builtinModels = builtin?.models || [];
  const storedModels = Array.isArray(stored.models) ? stored.models : [];

  // Combine: builtin default model first, then any extras
  const merged = [];
  if (builtin?.defaultModel && !merged.includes(builtin.defaultModel)) {
    merged.push(builtin.defaultModel);
  }
  for (const m of storedModels) {
    if (typeof m === 'string' && m.trim() && !merged.includes(m)) {
      merged.push(m.trim());
    }
  }
  for (const m of builtinModels) {
    if (typeof m === 'string' && m.trim() && !merged.includes(m)) {
      merged.push(m.trim());
    }
  }
  return merged;
}
```

#### 1.3 Update `src/cli/slash-commands.js` — `/model` command
- [x] Ubah behavior `/model` tanpa argumen → render box daftar model
- [x] Tandai model aktif dengan `▸ (active)` (warna yellow + bold)
- [x] Tampilkan section "Other providers" jika ada provider lain
- [x] Pertahankan logic `/model <name>` untuk set model baru
- [x] Backward compatible: `action` tetap `model_info` (bukan `model_list`); fallback single-line jika `configMgr`/`getProviderModels` tidak ada
- [x] Update help text `/model` di `SLASH_COMMANDS_HELP`

**Expected output:**
```
╔══════════════════════════════════════════════╗
║              Model (gemini)                  ║
╠══════════════════════════════════════════════╣
║   ▸ gemini-2.5-flash  (active)               ║
║      gemini-2.5-pro                          ║
║      gemini-1.5-flash                        ║
║      gemini-1.5-pro                          ║
║      gemini-2.0-flash                        ║
║                                              ║
║   Other providers:                           ║
║   openai: gpt-4o-mini, gpt-4o, gpt-4, gpt-3.5-turbo
╚══════════════════════════════════════════════╝
```

#### 1.4 Migration — Auto-populate `models` saat provider ditambahkan
- [x] Update function `setProviderField` agar auto-set `models` dari builtin
- [x] Hanya jalankan untuk builtin provider
- [x] Hanya jika `models` belum ada di stored config
- [x] Backward compatible: config lama tanpa `models` tetap works

#### 1.5 Tests
- [x] Tambah test `getProviderModels()` di `tests/step1-config.test.js`
  - [x] Test: return builtin models untuk builtin provider
  - [x] Test: merge defaultModel + builtin.models + stored.models
  - [x] Test: dedupe hasil
  - [x] Test: return array kosong untuk provider unknown
- [x] Tambah test `BUILTIN_PROVIDERS.models` di `tests/step1-providers-config.test.js`
  - [x] Test: `BUILTIN_PROVIDERS.gemini.models` adalah array
  - [x] Test: `BUILTIN_PROVIDERS.gemini.models` termasuk `defaultModel`
  - [x] Test: `BUILTIN_PROVIDERS.openai.models` adalah array
  - [x] Test: semua builtin models adalah non-empty string
- [x] Tambah test `setProviderField` auto-populate behavior
  - [x] Test: auto-populate models untuk builtin provider on first config
  - [x] Test: TIDAK overwrite user-customized models
  - [x] Test: TIDAK auto-populate untuk custom (non-builtin) provider
- [x] Run `npm test` — `206/206 pass` (195 existing + 11 baru di step1-providers-config)

---

### Phase 2: Interactive TUI Menu

**Target:** User bisa navigasi dan pilih model dengan arrow keys.

- [x] **2.1** Pilih dependency: **zero-dep** (Node.js built-in `readline.emitKeypressEvents` + raw mode) — Termux-friendly, lightweight, no third-party deps
- [x] **2.2** Buat file baru `src/ui/model-menu.js`
  - [x] Interactive vertical menu dengan arrow keys (↑/↓/j/k), Enter, Esc/Ctrl+C/q
  - [x] Menampilkan semua provider + model mereka (grouped by provider with section headers)
  - [x] Active model ditandai dengan `●` (selected) / `○` (unselected) + `(active)` tag
  - [x] Enter untuk select
  - [x] Home/End jump ke first/last item
  - [x] Pre-select model aktif saat menu dibuka
  - [x] Pure-function `buildModelMenuItems()` untuk testability
  - [x] Convenience wrapper `showModelMenuFromConfig()` untuk integrasi dengan ConfigManager
- [x] **2.3** Integrasi ke `slash-commands.js`
  - [x] Saat `/model` dipanggil tanpa argumen di REPL dengan TTY, jalankan interactive menu
  - [x] Pilih model → terapkan via setModel() + setProviderField() + update session
  - [x] Escape/Ctrl+C → fall through ke text box (Phase 1.3)
  - [x] Fallback ke text output jika bukan TTY (pipa/redirect)
  - [x] Update help text `/model`
- [x] **2.4** Tests di `tests/step2-model-menu.test.js` (18 tests)
  - [x] buildModelMenuItems: flat ordering, active marker, empty input
  - [x] showModelMenu: cancelled (no items / not TTY)
  - [x] showModelMenu: Enter selects active
  - [x] showModelMenu: down arrow moves selection
  - [x] showModelMenu: up arrow wraps from index 0
  - [x] showModelMenu: down arrow wraps from last item
  - [x] showModelMenu: escape / q / ctrl-c cancel
  - [x] showModelMenu: pre-selects active
  - [x] showModelMenu: home/end keys
  - [x] showModelMenu: output contains model names & markers
  - [x] showModelMenuFromConfig: missing configMgr returns cancelled
  - [x] showModelMenuFromConfig: builds items from real ConfigManager
  - [x] showModelMenuFromConfig: non-TTY input returns cancelled
- [x] **2.5** Integration tests di `tests/step5-piping.test.js` (3 tests)
  - [x] TTY: Enter applies selected model via `/model`
  - [x] TTY: Escape falls back to text box (no model change)
  - [x] Non-TTY: skips menu, renders text box
- [x] **2.6** `npm test` — `231/231 pass` (210 baseline + 18 step2-model-menu + 3 step5 integration)

---

### Phase 3: CLI Non-interactive Flags

**Target:** Bisa manage model dari command line tanpa masuk REPL.

- [x] **3.1** Update `src/cli/args.js`
  - [x] Flag `flags.modelList = false`    → `--list`
  - [x] Flag `flags.modelAll = false`     → `--all`
  - [x] Flag `flags.modelSet = null`      → `--set <model>`
  - [x] Recognize `model` / `models` as top-level command → routes to `model` with `list`/`set` subcommand
- [x] **3.2** Subcommand baru di `bin/tai.js`
  - [x] `tai model --list --provider nara`  *(implemented as `--provider <id>`)*
  - [x] `tai model --list --all`
  - [x] `tai model --set <model> --provider <id>`
  - [x] Bare `tai model` defaults to listing
- [x] **3.3** CLI handler di `src/cli/model-commands.js` (new module) — `listModelsCli`, `setModelCli`, `handleModelCommand`
  - [x] Registered in `src/cli/index.js`
  - [x] Renders ASCII box with `▸ (active)` marker (matches `/model` REPL output)
  - [x] `--all` groups every provider in a single box
  - [x] Unknown provider → exit 1 with helpful error
  - [x] Custom models not in builtin catalog are still saved (marked as such)
- [x] **3.4** Tests di `tests/step3-cli-model.test.js` (32 tests)
  - [x] 9 args.js: --list, --all, --set, --set=, bare `model`, `models` plural, defaults, --provider interplay, empty --set
  - [x] 6 listModelsCli: missing configMgr, active provider, --all, --provider override, unknown provider, box chars
  - [x] 6 setModelCli: persistence, custom model, --provider override, missing/empty name, missing configMgr, output
  - [x] 4 handleModelCommand dispatcher: list routing, set routing, --list flag fallback, unknown subcommand
  - [x] 7 e2e via `bin/tai.js` subprocess: --list, --list --all, --list --provider, --set persistence, bare `model`, --provider bogus exit 1, --help
- [x] **3.5** Update help text & README
  - [x] `src/cli/help.js`: MODEL COMMANDS section + examples
  - [x] `README.md`: Model Management section under Configuration
- [x] **3.6** `npm test` — `263/263 pass` (231 baseline + 32 phase 3)

---

## File yang Akan Diubah

| File | Perubahan | Phase | Status |
|------|-----------|:-----:|:------:|
| `src/config/constants.js` | Tambah field `models[]` ke BUILTIN_PROVIDERS | 1.1 | ✅ |
| `src/config/manager.js` | Tambah method `getProviderModels()` | 1.2 | ✅ |
| `src/config/manager.js` | Auto-populate `models` di `setProviderField` | 1.4 | ✅ |
| `src/cli/slash-commands.js` | Update case `'model'` untuk tampilkan list | 1.3 | ✅ |
| `src/ui/model-menu.js` | **[NEW]** Interactive TUI menu | 2.2 | ✅ |
| `tests/step2-model-menu.test.js` | **[NEW]** Unit tests for model-menu | 2.4 | ✅ |
| `src/cli/slash-commands.js` | Update case `'model'` for interactive menu | 2.3 | ✅ |
| `src/cli/args.js` | Tambah flag `--list`, `--all`, `--set` | 3.1 | ✅ |
| `src/cli/index.js` | Export `model-commands` module | 3.3 | ✅ |
| `bin/tai.js` | Subcommand `tai model ...` | 3.2 | ✅ |
| `src/cli/model-commands.js` | **[NEW]** CLI handler module (listModelsCli / setModelCli / handleModelCommand) | 3.3 | ✅ |
| `tests/step3-cli-model.test.js` | **[NEW]** 32 tests for `tai model` flags + handlers + e2e | 3.4 | ✅ |
| `tests/step1-config.test.js` | Test method `getProviderModels()` (tercover di `step1-providers-config.test.js`) | 1.5 | ✅ |
| `tests/step1-providers-config.test.js` | Test `BUILTIN_PROVIDERS.models` + `getProviderModels()` | 1.5 | ✅ |
| `tests/e2e-session-resume.test.js` | Verify session model persistence (model field save/load) | 1.5+ | ✅ |
| `README.md` | Update help & docs | 3.5 | ✅ |
| `docs/MULTI_MODEL_PLAN.md` | Update checklist + history | 3.5 | ✅ |

---

## Checklist Implementation (Ringkasan)

### Phase 1
- [x] Update `constants.js` — tambahkan `models[]` ke semua builtin provider
- [x] Update `manager.js` — tambah method `getProviderModels()`
- [x] Update `manager.js` — auto-populate `models` di `setProviderField`
- [x] Update `slash-commands.js` — case `/model` tanpa argumen tampilkan table
- [x] Update `slash-commands.js` — case `/model <name>` tetap set model baru *(logika existing masih ada, hanya perlu dijaga tidak rusak)*
- [x] Tambah tests di `step1-config.test.js` & `step1-providers-config.test.js`
- [ ] Test manual: jalankan `node bin/tai.js`, ketik `/model`
- [x] Run `npm test` — `210/210 pass` *(195 existing + 11 phase 1.5 + 4 phase 1.3)*

### Phase 2
- [x] Pilih dependency: zero-dep (Node.js `readline.emitKeypressEvents`)
- [x] Buat `src/ui/model-menu.js`
- [x] Integrasikan ke slash-commands
- [x] Test interaktivitas (TTY only) — 18 unit + 3 integration tests
- [x] `npm test` — 231/231 pass

### Phase 3
- [x] Update `args.js` parser (`--list`, `--all`, `--set`, `model` command)
- [x] Buat CLI handler baru di `src/cli/model-commands.js` (listModelsCli / setModelCli / handleModelCommand)
- [x] Wire handler ke `bin/tai.js`
- [x] Update `help.js` (MODEL COMMANDS section + examples)
- [x] Update `README.md` (Model Management section)
- [x] Add `tests/step3-cli-model.test.js` (32 tests, 263/263 total pass)

---

## Notes & Considerations

1. **Backward compatibility:** Config lama tanpa field `models` harus tetap works. `getProviderModels()` harus fallback ke `defaultModel` saja. ✅ (sudah diimplementasi)
2. **Custom providers:** Provider tambahan dari config user juga perlu support field `models`. ✅ (auto-populate dari builtin, dan `getProviderModels` baca `stored.models`)
3. **Session persistence:** Session menyimpan `model` field — pastikan setelah switch model, session baru tetap pakai model baru. ⬜ (perlu diverifikasi end-to-end)
4. **API key per model:** Beberapa provider butuh API key berbeda per model (jarang, tapi perlu dipertimbangkan). ⬜ (deferred)

---

## Riwayat Update Plan

| Tanggal | Commit | Perubahan |
|---------|--------|-----------|
| 2026-08-27 | `efc1fbb` | Plan awal dibuat di branch `feat/docs-multi-model-plan` |
| 2026-08-27 | `e530818` | Phase 1.1, 1.2, 1.4 selesai (di branch `feat/multi-model-phase1`) |
| 2026-08-27 | `a128489` | Plan di-import ke branch `feat/multi-model-phase1` |
| 2026-08-27 | `83013e8` | Plan di-restructure dengan checklist tracking |
| 2026-08-27 | `7088b7d` | Phase 1.5 selesai: 11 test baru (BUILTIN_PROVIDERS catalog + getProviderModels + setProviderField auto-populate); 206/206 tests pass |
| 2026-08-27 | *(pending)* | Phase 1.3 selesai: `/model` tanpa argumen render box daftar model; 4 test baru; 210/210 tests pass |
| 2026-08-27 | *(pending)* | Phase 2 selesai: zero-dep interactive TUI menu (`src/ui/model-menu.js`) dengan arrow-key navigation, group-by-provider, active marker, & TTY fallback. 18 unit + 3 integration tests. 231/231 tests pass. |
| 2026-08-27 | *(pending)* | Phase 3 selesai: non-interactive `tai model` CLI commands. Flags `--list` / `--all` / `--set` di `args.js`; handler module `src/cli/model-commands.js` (listModelsCli / setModelCli / handleModelCommand); wired ke `bin/tai.js`; updated help + README. 32 new tests di `tests/step3-cli-model.test.js`. 263/263 tests pass. |
| 2026-08-27 | *(pending)* | Final docs pass: checklist table dirapikan (`step1-config.test.js` → ✅ karena test ter-cover di `step1-providers-config.test.js`; `e2e-session-resume.test.js` → ✅ sudah verify `model` field persistence). |
