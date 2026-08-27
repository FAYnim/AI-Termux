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
- [ ] Hapus konstanta `SUPPORTED_MODELS` (duplikat dari `BUILTIN_PROVIDERS.gemini.models`)
- [ ] Pertahankan `DEFAULT_MODEL` sebagai alias/jembatan ke `BUILTIN_PROVIDERS.gemini.defaultModel` (atau jadikan satu-satunya via getter) — putuskan: *pertahankan `DEFAULT_MODEL` sebagai constant untuk backward-compat import*.
- [ ] Pastikan `DEFAULT_CONFIG` tidak lagi bergantung pada `SUPPORTED_MODELS`
- [ ] Tambahkan komentar JSDoc yang menjelaskan peran tiap field provider: `defaultModel` (aktif) vs `models[]` (katalog)

**Check:** Tidak ada lagi dua daftar model yang redundan untuk provider yang sama.

#### 1.2 Cek dependensi `SUPPORTED_MODELS` di seluruh codebase
- [ ] `grep -rn "SUPPORTED_MODELS" src/ bin/ tests/ scripts/`
- [ ] Ganti semua import/penggunaan `SUPPORTED_MODELS` dengan `BUILTIN_PROVIDERS[...].models` (atau `getProviderModels()`)
- [ ] Pastikan tidak ada test yang bergantung pada `SUPPORTED_MODELS`

#### 1.3 `src/config/manager.js` — jembatan konsistensi
- [ ] Validasi internal bahwa `defaultModel` **selalu** ada di `models[]` untuk setiap builtin provider (invariant/explicit check di `getProviderModels`)
- [ ] Tambahkan method kecil `getProviderNames()` (jika belum ada) agar CLI tidak menebak dari `Object.keys(BUILTIN_PROVIDERS)` saja — tapi tetap merge dengan stored custom providers

#### 1.4 Tests untuk source-of-truth
- [ ] Tambah test: `BUILTIN_PROVIDERS[*].defaultModel` ⊆ `BUILTIN_PROVIDERS[*].models` (untuk semua provider)
- [ ] Tambah test: tidak ada lagi ekspor `SUPPORTED_MODELS` dari `constants.js`
- [ ] Tambah test: `getProviderModels()` tetap konsisten setelah refactor (backward-compat)
- [ ] Run `npm test` — tidak boleh ada regression

---

### Phase 2 — Penamaan Field Menjadi Eksplisit (+ migrasi)

Tujuannya: `model` (aktif) vs `models[]` (katalog) tidak lagi ambigu. Karena mengubah nama field di config adalah breaking change, kita lakukan **renaming internal + backward-compatible alias** agar file config lama tetap terbaca.

#### 2.1 Desain nama field baru (internal)
- [ ] Field internal baru: `providers[id].activeModel` (menggantikan `model` sebagai nama aktif yang eksplisit)
- [ ] Field `providers[id].catalog` (alias dari `models[]`, lebih eksplisit)
- [ ] **Keputusan desain:** simpan alias `model` & `models` untuk backward-compat config lama, ATAU migrasi otomatis di `loadConfig()` (pilih & dokumentasikan)

> ⚠️ Catatan: Langkah ini opsional dan berisiko breaking. Konsep baru menentukan apakah renaming field layak, atau cukup **dokumentasi + alias pembaca** (getter) tanpa mengubah format tersimpan. **Default recommendation: lakukan getter/alias pembaca saja, jangan ubah format tersimpan** agar migrasi minimal.

#### 2.2 `src/config/manager.js` — getter pembaca (reader alias)
- [ ] Tambahkan `getActiveModel(providerId)` sebagai eksplisit getter untuk model aktif (membungkus logika `stored.model || builtin.defaultModel || envModelVars`)
- [ ] Tambahkan `getModelCatalog(providerId)` sebagai eksplisit getter untuk daftar katalog (membungkus `getProviderModels`)
- [ ] Pertahankan `getProviderModels()` sebagai deprecated alias yang memanggil `getModelCatalog()` (backward-compat untuk panggilan existing)

#### 2.3 Migrasi config lama (jika memilih ubah format)
- [ ] Di `loadConfig()`: deteksi config lama ber-field `model`/`models` → map ke `activeModel`/`catalog`
- [ ] Tulis migrasi sekali, idempotent (tetap aman jika dijalankan berulang)
- [ ] Uji dengan config fixture lama

---

### Phase 3 — Dokumentasi Urgensi Resolusi (CLI vs Config)

Jelaskan cara kerja `--model`/`--provider` (one-shot) vs `config set`/`model --set` (persisten) agar tidak ambigu.

#### 3.1 `docs/` — dokumen konsep provider & model
- [ ] Buat `docs/PROVIDER_MODEL_CONCEPT.md` berisi:
  - Hierarki Provider → Model (definisi formal)
  - Tabel "one-shot vs persistent" (CLI flag vs persisted config)
  - Diagram alur resolusi model `CLI flag → env → config → builtin default`
  - Aturan: kapan pakai `--model`, kapan `model --set`, kapan `config set model`
- [ ] Tambahkan link ke dokumen ini dari `README.md`

#### 3.2 `src/cli/help.js` — perjelas help text
- [ ] Update deskripsi `-m/--model` → tandai "(one-shot, tidak persisten)"
- [ ] Update deskripsi `-p/--provider` → tandai "(one-shot override)"
- [ ] Tambahkan contoh kalimat pembeda di MODEL COMMANDS: `model --set` (persisten) vs `--model` (sekali pakai)

#### 3.3 `README.md` — rapi ulang bagian provider/model
- [ ] Pisahkan section "Multi-Provider" dengan "One-shot override" dan "Persisted config" secara blok terpisah
- [ ] Tambahkan ringkasan 3 konsep `model` / `models[]` / `--model` (tabel kecil)
- [ ] Update tabel "Supported Models" → pindahkan dari `SUPPORTED_MODELS` ke per-provider catalog
- [ ] Hapus/mark legacy `SUPPORTED_MODELS` yang sudah tidak berlaku

---

### Phase 4 — Label OpenAI-Compatible yang Jelas (Persepsi = Realita)

#### 4.1 `README.md` — provider section
- [ ] Tandai OpenRouter/Groq/DeepSeek/Ollama sebagai **"OpenAI-Compatible"** (memakai adapter OpenAI dengan `--base-url`)
- [ ] Update "Multi-Provider" → jelaskan: 2 adapter native (Gemini, OpenAI) + N endpoint OpenAI-compatible
- [ ] Update contoh `provider add` agar menyebut `--adapter openai` (default) untuk provider custom

#### 4.2 `src/llm/registry.js` — dokumentasi & routing eksplisit
- [ ] Tambahkan komentar jelas bahwa `default` fallback adalah adapter OpenAI-compatible
- [ ] (Opsional) Ubah fallback agar memerlukan `options.adapter === 'openai'` ATAU provider di whitelist — putuskan; saat ini sudah memeriksa `baseUrl || adapter`, cukup dokumentasikan
- [ ] Pastikan unknown provider TANPA baseUrl/adapter tetap melempar error yang helpful (sudah terjadi)

#### 4.3 `src/config/constants.js` — tambahkan metadata adapter
- [ ] (Opsional) Tambahkan field `adapter: 'gemini' | 'openai'` ke `BUILTIN_PROVIDERS` untuk kejelasan kode
- [ ] Dokumentasikan bahwa provider custom default ke `adapter: 'openai'`

---

### Phase 5 — Verifikasi & Regression

#### 5.1 Unit tests menyeluruh
- [ ] Jalankan `npm test` → semua pass, 0 regression (baseline: 324 tests dari `main`)
- [ ] Jalankan `node scripts/benchmark.js` → performa tidak menurun (startup < 300ms, RAM < 50MB)

#### 5.2 E2E test (jika tersedia)
- [ ] Jalankan `node --test tests/e2e/*.test.js`
- [ ] Test manual: `tai model --list`, `tai model --set`, `tai --model gpt-4o "test"` one-shot, `tai provider show gemini`

#### 5.3 Uji backward-compat
- [ ] Simulasikan config lama (`~/.termuxai/config.json` dengan field `model`/`models`/`apiKey` legacy) → pastikan terbaca tanpa error
- [ ] Pastikan tidak ada fitur yang hilang dibanding `main` (fitur, bukan implementasi)

---

## 📁 File yang Akan Diubah

| File | Perubahan | Phase | Status |
|------|-----------|:-----:|:------:|
| `src/config/constants.js` | Hapus `SUPPORTED_MODELS`, JSDoc field provider, (ops) field `adapter` | 1.1, 4.3 | ⬜ |
| `src/config/manager.js` | Getter `getActiveModel`/`getModelCatalog`, alias deprecated, validasi invariant | 1.3, 2.2 | ⬜ |
| `src/cli/args.js` | (ops.) sesuaikan alias/deskripsi bila perlu | 3.2 | ⬜ |
| `src/cli/help.js` | Perjelas `--model`/`--provider` one-shot vs persistent | 3.2 | ⬜ |
| `src/cli/model-commands.js` | (ops.) gunakan getter baru bila renaming field diterapkan | 2.2 | ⬜ |
| `src/llm/registry.js` | Komentar adapter OpenAI-compatible yang jelas | 4.2 | ⬜ |
| `docs/PROVIDER_MODEL_CONCEPT.md` | **[NEW]** Dokumen konsep provider & model | 3.1 | ⬜ |
| `docs/REFACTOR_PROVIDER_MODEL_CLARITY.md` | **[THIS]** Update checklist & history | semua | ⬜ |
| `README.md` | Rapi ulang section provider/model, hapus/mark legacy | 3.3, 4.1 | ⬜ |
| `tests/*.test.js` | Test source-of-truth, getter baru, backward-compat | 1.4, 2.3 | ⬜ |

---

## ✅ Checklist Implementation (Ringkasan untuk Tracking)

### Phase 1 — Single Source of Truth
- [ ] **1.1** Hapus `SUPPORTED_MODELS` dari `constants.js`; `BUILTIN_PROVIDERS[*].models[]` jadi satu-satunya daftar resmi
- [ ] **1.2** Ganti semua dependensi `SUPPORTED_MODELS` (grep di src/bin/tests/scripts)
- [ ] **1.3** Validasi invariant `defaultModel ⊆ models[]` untuk semua builtin provider
- [ ] **1.4** Tambah test source-of-truth; `npm test` pass tanpa regression

### Phase 2 — Penamaan Eksplisit (getter, non-breaking)
- [ ] **2.1** Tetapkan desain: getter pembaca, JANGAN ubah format tersimpan (default recommendation)
- [ ] **2.2** Tambah `getActiveModel()` & `getModelCatalog()` di `manager.js`; `getProviderModels()` jadi alias deprecated
- [ ] **2.3** Test getter baru + backward-compat config lama

### Phase 3 — Dokumentasi Urgensi Resolusi
- [ ] **3.1** Buat `docs/PROVIDER_MODEL_CONCEPT.md` (hirarki, tabel one-shot vs persistent, alur resolusi)
- [ ] **3.2** Perjelas help text `--model`/`--provider` di `src/cli/help.js`
- [ ] **3.3** Rapi ulang `README.md`: blok one-shot vs persisted, tabel 3 konsep model, update "Supported Models"

### Phase 4 — Label OpenAI-Compatible
- [ ] **4.1** `README.md`: tandai OpenRouter/Groq/DeepSeek/Ollama sebagai OpenAI-Compatible
- [ ] **4.2** `src/llm/registry.js`: komentar jelas adapter OpenAI-compatible untuk fallback
- [ ] **4.3** (ops.) `constants.js`: metadata `adapter` per provider

### Phase 5 — Verifikasi & Regression
- [ ] **5.1** `npm test` → pass (baseline 324, 0 regression)
- [ ] **5.2** E2E + benchmark tidak menurun
- [ ] **5.3** Test manual backward-compat config lama; tidak ada fitur hilang

---

## ⚠️ Keputusan Desain yang Perlu Dikonfirmasi

1. **Renaming field vs getter biasa** — Apakah `manager.js` cukup menyediakan getter pembaca (`getActiveModel`/`getModelCatalog`) **tanpa** mengubah format yang tersimpan di `config.json`? *(Rekomendasi: Ya, getter saja — paling aman & non-breaking.)*
2. **Nasib `DEFAULT_MODEL`** — Pertahankan sebagai constant jembatan (backward-compat import) atau hapus lalu selalu pakai `BUILTIN_PROVIDERS.gemini.defaultModel`?
3. **Metadata `adapter`** — Apakah perlu menambahkan field `adapter` ke `BUILTIN_PROVIDERS` untuk kejelasan kode, atau cukup dokumentasi saja?

---

## 📊 Benchmark & Test Baseline

| Metric | Baseline (main) | Target Setelah Refactor |
|--------|:---------------:|:------------------------:|
| Unit tests | 324/324 pass | 324+ (tidak berkurang) |
| Startup time | < 300 ms | < 300 ms |
| RAM idle | < 50 MB | < 50 MB |
| Regression | 0 | 0 |

---

## 📈 Kriteria Selesai (Definition of Done)

- [ ] Tidak ada lagi referensi `SUPPORTED_MODELS` di codebase
- [ ] `BUILTIN_PROVIDERS[*].models[]` adalah satu-satunya daftar resmi model per provider
- [ ] Getter eksplisit `getActiveModel`/`getModelCatalog` tersedia; `getProviderModels` deprecated tapi backward-compat
- [ ] `docs/PROVIDER_MODEL_CONCEPT.md` dibuat & di-link dari README
- [ ] README & help text akurat: one-shot vs persistent jelas, OpenAI-Compatible terlabel
- [ ] Semua test pass, 0 regression, benchmark tidak menurun
- [ ] Config lama tetap terbaca tanpa migrasi manual oleh user

---

## 📝 Riwayat Update Plan

| Tanggal | Perubahan |
|---------|-----------|
| 2026-08-27 | Plan awal dibuat di branch `refactor/provider-model-clarity` |
| *(pending)* | Phase 1 selesai: single source of truth |
| *(pending)* | Phase 2 selesai: getter eksplisit non-breaking |
| *(pending)* | Phase 3 selesai: dokumentasi konsep + help + README |
| *(pending)* | Phase 4 selesai: label OpenAI-Compatible akurat |
| *(pending)* | Phase 5 selesai: verifikasi & regression 0 |