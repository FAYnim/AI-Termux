# Plan: Refactor Provider & Model — Clarity & Single Source of Truth

**Issue:** Fitur Multi-Provider + Multi-Model terasa membingungkan bagi pengguna & developer karena ada konsep yang namanya serupa, duplikat source-of-truth, dan ketidakcocokan antara dokumentasi vs realita backend.

**Goal:** Menjadikan model **provider** & **model** LLM konsisten, eksplisit, dan tidak ambigu — dengan satu sumber kebenaran (single source of truth), penamaan yang jelas, dan dokumentasi yang akurat.

**Branch:** `refactor/provider-model-clarity`
**Based on:** `main` (ancestor dari `feat/multi-model-phase1`)
**Last updated:** 2026-08-27

---

## 🔍 Ringkasan Masalah (Root Cause)

Berdasarkan analisis kode (`src/config/constants.js`, `src/config/manager.js`, `src/cli/args.js`, `src/cli/model-commands.js`, `src/llm/registry.js`, `README.md`), ada **4 akar masalah**:

### Masalah 1 — Tiga konsep dengan nama serupa: `model`, `models[]`, `--model`
| Konsep | Makna | Sifat |
|--------|-------|-------|
| `providers[id].model` | **Model aktif/default** yang dipakai saat request | Satu nilai, persisten |
| `providers[id].models[]` | **Katalog** daftar model yang tersedia | Banyak nilai, persisten |
| `--model` CLI flag | Override **sekali pakai** (tidak persisten) | Satu nilai, transien |

Ketiganya hidup di dalam struktur provider yang sama, sehingga mudah tertukar. `model` (aktif) dan `models[]` (katalog) disimpan dalam objek provider yang sama, padahal perannya beda.

### Masalah 2 — Duplikasi source-of-truth model
Di `src/config/constants.js` terdapat **dua daftar model "resmi" yang terpisah**:
- `SUPPORTED_MODELS` (hanya Gemini, legacy, list statis)
- `BUILTIN_PROVIDERS.gemini.models` (list baru milik multi-model)

Keduanya mendeskripsikan hal yang sama (model Gemini yang tersedia) tapi tidak otomatis sinkron. Config docs di README juga masih merujuk `SUPPORTED_MODELS` dan `DEFAULT_MODEL` secara terpisah.

### Masalah 3 — Banyaknya lapisan fallback yang bisa saling menimpa
Untuk menentukan model/baseUrl/apiKey yang benar-benar dipakai saat eksekusi, kode memeriksa beberapa lapis berurutan:
```
CLI flag → env var → config.json (providers[id]) → builtin default
```
Ini sah secara arsitektur, tapi tanpa dokumentasi yang jelas pengguna bingung "kenapa model yang saya set tidak kepakai".

### Masalah 4 — Ketidakcocokan README vs backend (persepsi vs realita)
README mengklaim "Multi-Provider: Gemini, OpenAI, **OpenRouter, Groq, DeepSeek, Ollama**" — memberi kesan ada 7 provider terpisah. Padahal di `src/llm/registry.js` hanya ada **2 adapter nyata**: `GeminiClient` dan `OpenAIClient`. OpenRouter/Groq/DeepSeek/Ollama hanyalah **konfigurasi OpenAI-compatible** (memakai `OpenAIClient` dengan `--base-url` berbeda).

---

## 🎯 Ruang Lingkup (Scope)

### Yang DIKERJAKAN dalam refactor ini
1. Menghapus duplikasi source-of-truth model (`SUPPORTED_MODELS` → kembali ke `BUILTIN_PROVIDERS`).
2. Menamai ulang field konfigurasi agar eksplisit (dengan migrasi backward-compatible).
3. Menambahkan dokumentasi urgensi resolusi `--model` vs `model` vs `models[]`.
4. Melabeli adapter OpenAI-compatible secara jelas agar persepsi sesuai realita.
5. Menambah test untuk memastikan tidak ada regresi dan single-source-of-truth terjaga.

### Yang TIDAK dikerjakan (out of scope, agar fokus)
- ❌ Menambah provider/adapter baru (murni refactor, bukan fitur).
- ❌ Mengubah protokol LLM client (Gemini/OpenAI internal tetap sama).
- ❌ Merombak seluruh CLI arg parsing (hanya sesuaikan nama/alias bila perlu).
- ❌ Mengubah format session files (tidak perlu; hanya config provider yang disentuh).

---

## 🧱 Rencana Implementasi (Phases)

### Phase 1 — Single Source of Truth untuk Model
Hapus duplikasi dan jadikan `BUILTIN_PROVIDERS[*].models[]` sebagai satu-satunya daftar resmi model per provider.

#### 1.1 `src/config/constants.js`
- [x] Hapus konstanta `SUPPORTED_MODELS` (duplikat dari `BUILTIN_PROVIDERS.gemini.models`)
- [x] Pertahankan `DEFAULT_MODEL` sebagai alias/jembatan ke `BUILTIN_PROVIDERS.gemini.defaultModel` (atau jadikan satu-satunya via getter) — putuskan: *pertahankan `DEFAULT_MODEL` sebagai constant untuk backward-compat import*.
- [x] Pastikan `DEFAULT_CONFIG` tidak lagi bergantung pada `SUPPORTED_MODELS`
- [x] Tambahkan komentar JSDoc yang menjelaskan peran tiap field provider: `defaultModel` (aktif) vs `models[]` (katalog)

**Check:** Tidak ada lagi dua daftar model yang redundan untuk provider yang sama.

#### 1.2 Cek dependensi `SUPPORTED_MODELS` di seluruh codebase
- [x] `grep -rn "SUPPORTED_MODELS" src/ bin/ tests/ scripts/` → 0 hasil (dead code, hanya dideklarasikan di constants.js)
- [x] `grep -rn "supportedModels\|supported.models" --include="*.js" .` → 0 hasil (tidak ada varian case-insensitive)
- [x] Ganti semua import/penggunaan `SUPPORTED_MODELS` dengan `BUILTIN_PROVIDERS[...].models` (atau `getProviderModels()`) → tidak perlu, tidak ada import/penggunaan
- [x] Pastikan tidak ada test yang bergantung pada `SUPPORTED_MODELS` → konfirmasi via baseline `npm test` 324/324 pass setelah 1.1

#### 1.3 `src/config/manager.js` — jembatan konsistensi
- [x] Validasi internal bahwa `defaultModel` **selalu** ada di `models[]` untuk setiap builtin provider — diimplementasikan sebagai IIFE `validateBuiltinProviderInvariants()` yang berjalan saat module dimuat, melempar error deskriptif bila invarian dilanggar (mencakup: defaultModel bukan string, models bukan array/non-empty, defaultModel tidak ada di models[], atau ada entry non-string/blank di models[])
- [x] Tambahkan method `getProviderNames()` di `ConfigManager` — mengembalikan union builtin (urut deklarasi) + custom (urut alfabetis), menjadi single source of truth untuk "provider apa saja yang ada" agar CLI tidak menebak dari `Object.keys(BUILTIN_PROVIDERS)` saja

#### 1.4 Tests untuk source-of-truth
- [x] Tambah test: `BUILTIN_PROVIDERS[*].defaultModel` ⊆ `BUILTIN_PROVIDERS[*].models` (untuk semua provider)
- [x] Tambah test: tidak ada lagi ekspor `SUPPORTED_MODELS` dari `constants.js`
- [x] Tambah test: `getProviderModels()` tetap konsisten setelah refactor (backward-compat)
- [x] Tambah test: `getProviderNames()` — builtin ∪ custom, urutan stabil
- [x] Run `npm test` — 22 test baru pass (phase1-source-of-truth.test.js); 15 pre-existing E2E CLI failures tidak dipengaruhi refactor ini

---

### Phase 2 — Penamaan Field Menjadi Eksplisit (+ migrasi)

Tujuannya: `model` (aktif) vs `models[]` (katalog) tidak lagi ambigu. Karena mengubah nama field di config adalah breaking change, kita lakukan **renaming internal + backward-compatible alias** agar file config lama tetap terbaca.

#### 2.1 Desain nama field baru (internal) ✅
- [x] Field internal baru: `providers[id].activeModel` (menggantikan `model` sebagai nama aktif yang eksplisit) — **diadopsi sebagai read-side alias, bukan field tersimpan**
- [x] Field `providers[id].catalog` (alias dari `models[]`, lebih eksplisit) — **diadopsi sebagai read-side alias, bukan field tersimpan**
- [x] **Keputusan desain (ADR):** gunakan **getter pembaca saja** (`getActiveModel`, `getModelCatalog`) — **JANGAN ubah format tersimpan** di `config.json` agar 100% non-breaking
  - **Alasan:** backward-compat prioritas tertinggi; user yang sudah punya config lama (`{ model: "...", models: [...] }`) tidak boleh terganggu.
  - **Konsekuensi:** nama `model` & `models` tetap dipakai di storage layer; nama `activeModel` & `catalog` adalah **konsep baca** yang diekspos lewat getter.
  - **Implikasi ke step 2.2:** implementasi getter (sudah selesai di 2.1 sebagai fondasi); step 2.2 tinggal memigrasi call sites (CLI/REPL/registry) untuk prefer getter baru.

> ⚠️ Catatan: Langkah ini opsional dan berisiko breaking. Konsep baru menentukan apakah renaming field layak, atau cukup **dokumentasi + alias pembaca** (getter) tanpa mengubah format tersimpan. **Default recommendation: lakukan getter/alias pembaca saja, jangan ubah format tersimpan** agar migrasi minimal.
>
> ✅ **Status (2026-08-27):** Keputusan akhir = **getter pembaca saja, format tersimpan tidak berubah**. Stub `getActiveModel(providerId)` dan `getModelCatalog(providerId)` ditambahkan di `src/config/manager.js` (read-side alias non-breaking). Lihat JSDoc di method untuk kontrak lengkap.

#### 2.2 `src/config/manager.js` — getter pembaca (reader alias)
- [x] Tambahkan `getActiveModel(providerId)` sebagai eksplisit getter untuk model aktif (membungkus logika `stored.model || builtin.defaultModel || envModelVars`)
- [x] Tambahkan `getModelCatalog(providerId)` sebagai eksplisit getter untuk daftar katalog (sekarang menjadi **canonical implementation** — logic dipindah dari `getProviderModels` ke sini)
- [x] Pertahankan `getProviderModels()` sebagai deprecated alias yang memanggil `getModelCatalog()` (backward-compat untuk panggilan existing)

#### 2.3 Migrasi call sites ke getter baru
- [x] `src/cli/model-commands.js` — semua `getProviderModels()` → `getModelCatalog()`; `getProviderConfig().model` → `getActiveModel()`; `listKnownProviders()` → `getProviderNames()`
- [x] `src/cli/slash-commands.js` — semua `getProviderModels()` → `getModelCatalog()`; guard `typeof` diperbarui; `getProviderConfig().model` → `getActiveModel()`
- [x] `src/ui/model-menu.js` — `getProviderModels()` → `getModelCatalog()`; guard `typeof` diperbarui; `provCfg.model` → `getActiveModel()`
- [x] `getProviderModels()` di `manager.js` mengeluarkan `DeprecationWarning` (code: `TAI_DEPRECATED_GET_PROVIDER_MODELS`) via `process.emitWarning()` sekali per providerId (dapat disuppress dengan `--no-deprecation`)
- [x] `npm test` (unit, phase1+2): 44+25 pass, 0 regresi baru; E2E pre-existing failures tidak berubah

---

### Phase 3 — Dokumentasi Urgensi Resolusi (CLI vs Config)

Jelaskan cara kerja `--model`/`--provider` (one-shot) vs `config set`/`model --set` (persisten) agar tidak ambigu.

#### 3.1 `docs/` — dokumen konsep provider & model
- [x] Buat `docs/PROVIDER_MODEL_CONCEPT.md` berisi:
  - Hierarki Provider → Model (definisi formal)
  - Tabel "one-shot vs persistent" (CLI flag vs persisted config)
  - Diagram alur resolusi model `CLI flag → env → config → builtin default`
  - Aturan: kapan pakai `--model`, kapan `model --set`, kapan `config set model`
- [x] Tambahkan link ke dokumen ini dari `README.md`

#### 3.2 `src/cli/help.js` — perjelas help text
- [x] Update deskripsi `-m/--model` → tandai "(one-shot, tidak persisten)"
- [x] Update deskripsi `-p/--provider` → tandai "(one-shot override)"
- [x] Tambahkan contoh kalimat pembeda di MODEL COMMANDS: `model --set` (persisten) vs `--model` (sekali pakai)

#### 3.3 `README.md` — rapi ulang bagian provider/model
- [x] Pisahkan section "Multi-Provider" dengan "One-shot override" dan "Persisted config" secara blok terpisah
- [x] Tambahkan ringkasan 3 konsep `model` / `models[]` / `--model` (tabel kecil)
- [x] Update tabel "Supported Models" → pindahkan dari `SUPPORTED_MODELS` ke per-provider catalog
- [x] Hapus/mark legacy `SUPPORTED_MODELS` yang sudah tidak berlaku

---

### Phase 4 — Label OpenAI-Compatible yang Jelas (Persepsi = Realita)

#### 4.1 `README.md` — provider section
- [x] Tandai OpenRouter/Groq/DeepSeek/Ollama sebagai **"OpenAI-Compatible"** (memakai adapter OpenAI dengan `--base-url`)
- [x] Update "Multi-Provider" → jelaskan: 2 adapter native (Gemini, OpenAI) + N endpoint OpenAI-compatible
- [x] Update contoh `provider add` agar menyebut `--adapter openai` (default) untuk provider custom

#### 4.2 `src/llm/registry.js` — dokumentasi & routing eksplisit
- [x] Tambahkan komentar jelas bahwa `default` fallback adalah adapter OpenAI-compatible
- [x] (Opsional) Ubah fallback agar memerlukan `options.adapter === 'openai'` ATAU provider di whitelist — didokumentasikan & didukung via `baseUrl || options.adapter === 'openai'`
- [x] Pastikan unknown provider TANPA baseUrl/adapter tetap melempar error yang helpful (sudah diuji & diverifikasi)

#### 4.3 `src/config/constants.js` — tambahkan metadata adapter
- [x] Tambahkan field `adapter: 'gemini' | 'openai'` ke `BUILTIN_PROVIDERS` untuk kejelasan kode
- [x] Dokumentasikan bahwa provider custom default ke `adapter: 'openai'`

---

### Phase 5 — Verifikasi & Regression

#### 5.1 Unit tests menyeluruh
- [x] Jalankan `npm test` → 394/394 unit tests pass, 0 regression (baseline: 324 tests dari `main`, +70 tests baru)
- [x] Jalankan `node scripts/benchmark.js` → RAM RSS idle 43.48 MB (< 50MB target terpenuhi); import time modul utama ~248ms

#### 5.2 E2E test (jika tersedia)
- [x] Jalankan `npm run test:e2e` → 3/3 suites, 23/23 tests pass; `npm run test:all` → 417/417 tests pass (73 suites)
- [x] Test manual CLI: `tai model --list`, `tai model --set`, `tai --model`, `tai provider show gemini`, `tai provider add/list`

#### 5.3 Uji backward-compat
- [x] Simulasikan config lama (`~/.termuxai/config.json` dengan field `model`/`models`/`apiKey` legacy) → diverifikasi lewat `tests/phase5-verification.test.js` (15/15 pass)
- [x] Pastikan tidak ada fitur yang hilang dibanding `main` (semua fitur CRUD model, provider switching, one-shot override berjalan konsisten dan aman)

---

## 📁 File yang Akan Diubah

| File | Perubahan | Phase | Status |
|------|-----------|:-----:|:------:|
| `src/config/constants.js` | Hapus `SUPPORTED_MODELS`, JSDoc field provider, metadata field `adapter` | 1.1, 4.3 | ✅ |
| `src/config/manager.js` | Getter `getActiveModel`/`getModelCatalog`, alias deprecated, validasi invariant | 1.3, 2.1, 2.2 | ✅ |
| `src/cli/args.js` | Parsing flag `--adapter` & opsi model CLI | 3.2, 4.1 | ✅ |
| `src/cli/help.js` | Perjelas `--model`/`--provider` one-shot vs persistent, opsi `--adapter` | 3.2, 4.1 | ✅ |
| `src/cli/model-commands.js` | Migrasi ke getter baru (`getModelCatalog`, `getActiveModel`, `getProviderNames`) | 2.2 | ✅ |
| `src/llm/registry.js` | Komentar adapter OpenAI-compatible yang jelas & routing | 4.2 | ✅ |
| `src/agent/orchestrator.js` | Dukungan passing `adapter` ke `createLlmClient` | 4.2 | ✅ |
| `bin/tai.js` | Dukungan `--adapter` pada `provider add` dan `createAgentOrchestrator` | 4.1, 4.2 | ✅ |
| `docs/PROVIDER_MODEL_CONCEPT.md` | **[NEW]** Dokumen konsep provider & model | 3.1 | ✅ |
| `docs/REFACTOR_PROVIDER_MODEL_CLARITY.md` | **[THIS]** Update checklist & history | semua | ✅ |
| `README.md` | Rapi ulang section provider/model, label OpenAI-Compatible | 3.3, 4.1 | ✅ |
| `tests/phase1-source-of-truth.test.js` | **[NEW]** Test source-of-truth (1.4-A/B/C/D): invariant BUILTIN_PROVIDERS, hapus SUPPORTED_MODELS, getProviderModels backward-compat, getProviderNames | 1.4 | ✅ |
| `tests/phase2-getters.test.js` | **[NEW]** Test getter Phase 2.1-A/B/C/D/E: precedence getActiveModel, getModelCatalog alias, no-write guarantee, legacy config backward-compat, cross-consistency | 2.1 | ✅ |
| `tests/phase4-openai-compatible.test.js` | **[NEW]** Test Phase 4.1/4.2/4.3: metadata adapter, routing createLlmClient, dan parsing flag `--adapter` | 4.1-4.3 | ✅ |
| `tests/phase5-verification.test.js` | **[NEW]** Test Phase 5.1/5.2/5.3: invariant BUILTIN_PROVIDERS, CLI end-to-end sandbox, legacy flat/custom backward compatibility, read-only guarantee | 5.1-5.3 | ✅ |

---

## ✅ Checklist Implementation (Ringkasan untuk Tracking)

### Phase 1 — Single Source of Truth
- [x] **1.1** Hapus `SUPPORTED_MODELS` dari `constants.js`; `BUILTIN_PROVIDERS[*].models[]` jadi satu-satunya daftar resmi
- [x] **1.2** Ganti semua dependensi `SUPPORTED_MODELS` (grep di src/bin/tests/scripts) — tidak ada dependensi, langsung selesai
- [x] **1.3** Validasi invariant `defaultModel ⊆ models[]` untuk semua builtin provider + tambah `getProviderNames()` (builtin ∪ custom)
- [x] **1.4** Tambah test source-of-truth (`phase1-source-of-truth.test.js`): 22/22 pass; `npm test` — unit tests tidak ada regresi dari perubahan Phase 1

### Phase 2 — Penamaan Eksplisit (getter, non-breaking)
- [x] **2.1** Tetapkan desain: getter pembaca, JANGAN ubah format tersimpan (default recommendation) — **ADR dicatat + stub getter `getActiveModel()` & `getModelCatalog()` ditambahkan di `manager.js` (read-side alias non-breaking)**
- [x] **2.2** `getModelCatalog()` jadi **canonical implementation** (logic dipindah dari `getProviderModels`); `getProviderModels()` jadi deprecated alias dengan `process.emitWarning()` (DeprecationWarning, dapat disuppress).
- [x] **2.3** Migrasikan call sites (`model-commands.js`, `slash-commands.js`, `ui/model-menu.js`) — semua `getProviderModels()` → `getModelCatalog()`; `getProviderConfig().model` → `getActiveModel()`; `listKnownProviders()` → `getProviderNames()`. 44+25 unit tests pass, 0 regresi baru.

### Phase 3 — Dokumentasi Urgensi Resolusi
- [x] **3.1** Buat `docs/PROVIDER_MODEL_CONCEPT.md` (hirarki, tabel one-shot vs persistent, alur resolusi)
- [x] **3.2** Perjelas help text `--model`/`--provider` di `src/cli/help.js`
- [x] **3.3** Rapi ulang `README.md`: blok one-shot vs persisted, tabel 3 konsep model, update "Supported Models"

### Phase 4 — Label OpenAI-Compatible
- [x] **4.1** `README.md`: tandai OpenRouter/Groq/DeepSeek/Ollama sebagai OpenAI-Compatible, perbarui contoh `provider add --adapter openai`
- [x] **4.2** `src/llm/registry.js`: komentar jelas adapter OpenAI-compatible untuk fallback & dukungan `adapter` di orchestrator/tai.js
- [x] **4.3** `constants.js`: metadata `adapter` per builtin provider (`gemini` & `openai`)

### Phase 5 — Verifikasi & Regression
- [x] **5.1** `npm test` → pass (394 unit tests, baseline 324, 0 regression); `npm run test:all` → 417 pass; benchmark RAM 43.48 MB (< 50MB)
- [x] **5.2** E2E test `npm run test:e2e` (23/23 pass) + manual CLI verification (model list, set, add, show, provider list/add/show)
- [x] **5.3** Uji backward-compat config lama via `tests/phase5-verification.test.js` (15/15 pass); 0 fitur hilang

---

## ⚠️ Keputusan Desain yang Perlu Dikonfirmasi

1. **Renaming field vs getter biasa** — Apakah `manager.js` cukup menyediakan getter pembaca (`getActiveModel`/`getModelCatalog`) **tanpa** mengubah format yang tersimpan di `config.json`? *(Rekomendasi: Ya, getter saja — paling aman & non-breaking.)*
2. **Nasib `DEFAULT_MODEL`** — Pertahankan sebagai constant jembatan (backward-compat import) atau hapus lalu selalu pakai `BUILTIN_PROVIDERS.gemini.defaultModel`?
3. **Metadata `adapter`** — Apakah perlu menambahkan field `adapter` ke `BUILTIN_PROVIDERS` untuk kejelasan kode, atau cukup dokumentasi saja? *(Status: Selesai di Phase 4.3 — field `adapter: 'gemini' | 'openai'` ditambahkan)*

---

## 📊 Benchmark & Test Baseline

| Metric | Baseline (main) | Target Setelah Refactor | Hasil Aktual |
|--------|:---------------:|:------------------------:|:------------:|
| Unit tests | 324/324 pass | 324+ (tidak berkurang) | **394/394 pass** (unit), **417/417 pass** (all) |
| Startup time (module load) | < 300 ms | < 300 ms | **~248 ms** (in-process) |
| RAM idle | < 50 MB | < 50 MB | **43.48 MB** (RSS) |
| Regression | 0 | 0 | **0 regression** |

---

## 📈 Kriteria Selesai (Definition of Done)

- [x] Tidak ada lagi referensi `SUPPORTED_MODELS` di codebase
- [x] `BUILTIN_PROVIDERS[*].models[]` adalah satu-satunya daftar resmi model per provider
- [x] Getter eksplisit `getActiveModel`/`getModelCatalog` tersedia; `getProviderModels` deprecated tapi backward-compat
- [x] `docs/PROVIDER_MODEL_CONCEPT.md` dibuat & di-link dari README
- [x] README & help text akurat: one-shot vs persistent jelas, OpenAI-Compatible terlabel
- [x] Semua test pass, 0 regression, benchmark tidak menurun
- [x] Config lama tetap terbaca tanpa migrasi manual oleh user

---

## 📝 Riwayat Update Plan

| Tanggal | Perubahan |
|---------|-----------|
| 2026-08-27 | Plan awal dibuat di branch `refactor/provider-model-clarity` |
| 2026-08-27 | Phase 1.1 selesai: hapus `SUPPORTED_MODELS` (dead code), tambah JSDoc + invariant di `constants.js` |
| 2026-08-27 | Phase 1.2 selesai: verifikasi `grep` mengonfirmasi 0 dependensi `SUPPORTED_MODELS` di seluruh codebase |
| 2026-08-27 | Phase 1.3 selesai: IIFE `validateBuiltinProviderInvariants()` di `manager.js` (fail-fast module-load) + method `getProviderNames()` (builtin ∪ sorted custom) |
| 2026-08-27 | Phase 1.4 selesai: tambah `tests/phase1-source-of-truth.test.js` — 22 test pass (4 grup: invariant BUILTIN_PROVIDERS, hapus SUPPORTED_MODELS, getProviderModels backward-compat, getProviderNames SoT) |
| 2026-08-27 | Phase 2.1 selesai: ADR getter-only (NON-breaking), stub `getActiveModel()` + `getModelCatalog()` ditambahkan di `manager.js`; `npm test` 346/346 pass, 0 regression |
| 2026-08-28 | Phase 2.2 selesai: `getModelCatalog()` jadi canonical implementation; `getProviderModels()` jadi deprecated alias dengan `process.emitWarning()` (DeprecationWarning code: `TAI_DEPRECATED_GET_PROVIDER_MODELS`); migrasi call sites di `model-commands.js`, `slash-commands.js`, `model-menu.js`; `listKnownProviders()` → `getProviderNames()`; 44 phase1+2 tests + 25 unit tests pass, 0 regresi baru |
| 2026-08-28 | Phase 3 selesai: dokumen `docs/PROVIDER_MODEL_CONCEPT.md` lengkap (hierarki, alur resolusi, tabel one-shot vs persistent), `src/cli/help.js` dan `README.md` diperjelas dengan perbedaan one-shot vs persistent |
| 2026-08-28 | Phase 4 selesai: metadata `adapter` di `BUILTIN_PROVIDERS`, JSDoc & komentar routing di `src/llm/registry.js`, parsing `--adapter` di CLI args/help/orchestrator/tai.js, dan test `tests/phase4-openai-compatible.test.js` (11/11 pass) |
| 2026-08-28 | Phase 5 selesai: verifikasi & regression 0; cross-platform path resolution fix untuk test runner subprocess; penambahan `tests/phase5-verification.test.js` (15 tests); 394/394 unit tests pass, 417/417 all tests pass (73 suites), memory 43.48 MB (< 50MB), 100% backward-compatible |