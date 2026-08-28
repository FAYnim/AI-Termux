# Provider & Model Concept — Termux AI CLI

> **Bacaan wajib** sebelum menyentuh konfigurasi provider atau model.
> Dokumen ini menjelaskan tiga konsep yang namanya mirip tapi perannya berbeda,
> sehingga Anda tidak pernah bertanya-tanya "kenapa model yang saya set tidak kepakai?"

---

## 1. Tiga Konsep yang Sering Tertukar

| Konsep | Lokasi | Makna | Sifat |
|--------|--------|-------|-------|
| `providers[id].model` | `config.json` | **Model aktif/terpilih** — yang dipakai saat mengirim request ke LLM | Satu nilai, **persisten** |
| `providers[id].models[]` | `config.json` | **Katalog model** — daftar model yang tersedia untuk provider ini | Banyak nilai, **persisten** |
| `--model <name>` | CLI flag | **Override sekali pakai** — menimpa model aktif hanya untuk satu perintah | Satu nilai, **transien** (tidak disimpan) |

> **Aturan emas:** `--model` tidak pernah mengubah `config.json`.
> Jika Anda ingin perubahan bertahan, gunakan `tai model --set` atau `config set`.

---

## 2. Hierarki Provider → Model

```
Provider (e.g. "gemini")
├── activeModel          ← satu model yang sedang aktif (getActiveModel())
│   └── Resolusi: stored.model → env var → builtin.defaultModel
└── catalog (models[])  ← daftar semua model yang dikenal (getModelCatalog())
    ├── gemini-2.5-flash  ← builtin default (selalu ada di sini)
    ├── gemini-2.5-pro
    ├── gemini-1.5-flash
    ├── gemini-1.5-pro
    └── gemini-2.0-flash
```

- Setiap **provider** memiliki tepat satu **activeModel** (model yang dipakai saat request).
- Setiap **provider** memiliki satu **catalog** (daftar model yang bisa dipilih).
- **activeModel** dijamin selalu muncul di dalam **catalog** — baik itu model builtin
  maupun model kustom yang Anda tambahkan sendiri.

---

## 3. Tabel: One-Shot vs Persistent

| Cara | Perintah | Simpan ke config? | Berlaku untuk |
|------|----------|:-----------------:|---------------|
| **One-shot CLI flag** | `tai --model gpt-4o "prompt"` | ❌ Tidak | Hanya run ini |
| **One-shot provider** | `tai --provider openai "prompt"` | ❌ Tidak | Hanya run ini |
| **Persistent model** | `tai model --set gpt-4o` | ✅ Ya | Semua run berikutnya |
| **Persistent provider** | `tai provider use openai` | ✅ Ya | Semua run berikutnya |
| **Config set** | `tai config set model gpt-4o` | ✅ Ya | Semua run berikutnya |
| **REPL /model** | `/model gpt-4o` (di REPL) | ✅ Ya | Sesi ini + semua run berikutnya |

### Kapan memakai yang mana?

| Skenario | Rekomendasi |
|----------|-------------|
| Coba model baru tanpa mengubah default | `tai --model gemini-2.5-pro "prompt"` |
| Ganti model default secara permanen | `tai model --set gemini-2.5-pro` |
| Coba provider berbeda untuk satu query | `tai --provider openai "prompt"` |
| Pindah ke provider lain secara permanen | `tai provider use openai` |
| Lihat model apa saja yang tersedia | `tai model --list [--all]` |
| Tambah model ke katalog (tanpa aktifkan) | `tai model --add my-finetune-v1` |

---

## 4. Diagram Alur Resolusi Model

Urutan prioritas berikut berlaku setiap kali `termuxai` menentukan model mana
yang benar-benar dipakai untuk mengirim request:

```
┌─────────────────────────────────────────────────────────────────┐
│              RESOLUSI MODEL (urut prioritas, tertinggi dulu)    │
│                                                                 │
│  1. CLI flag --model <name>                                     │
│     └─► Dipakai hanya untuk run ini, TIDAK disimpan             │
│                                                                 │
│  2. Env var (builtin envModelVars per provider)                 │
│     └─► Misal: OPENAI_MODEL=gpt-4o (untuk provider openai)     │
│                                                                 │
│  3. config.json → providers[activeProvider].model               │
│     └─► Disimpan via `tai model --set` atau `tai config set`   │
│                                                                 │
│  4. BUILTIN_PROVIDERS[activeProvider].defaultModel              │
│     └─► Fallback terakhir; tidak bisa kosong                   │
│                                                                 │
│  Pemenang: nilai NON-KOSONG pertama dari atas                  │
└─────────────────────────────────────────────────────────────────┘
```

Untuk **provider** (bukan model), alur resolusinya serupa:

```
1. CLI flag --provider <id>         → one-shot, tidak disimpan
2. config.json → activeProvider     → disimpan via `tai provider use`
3. Default: "gemini"
```

---

## 5. Struktur Adapter: 2 Native + N OpenAI-Compatible

`termuxai` memiliki **2 adapter LLM nyata** di `src/llm/registry.js`:

| Adapter | Dipakai untuk |
|---------|---------------|
| `GeminiClient` | Provider `gemini` (native Google Generative Language API) |
| `OpenAIClient` | Provider `openai` + semua endpoint OpenAI-compatible |

Provider seperti **Groq, OpenRouter, DeepSeek, Ollama** bukan adapter baru —
mereka adalah **konfigurasi `OpenAIClient`** dengan `--base-url` berbeda:

```bash
# Groq: OpenAI-compatible adapter + base URL Groq
tai provider add groq --base-url "https://api.groq.com/openai/v1" --api-key "gsk_..."

# OpenRouter: OpenAI-compatible adapter + base URL OpenRouter
tai provider add openrouter --base-url "https://openrouter.ai/api/v1" --api-key "sk-or-..."
```

Jadi daftar di README yang menyebut "6 provider" lebih tepat dibaca sebagai
**"2 adapter native + banyak endpoint OpenAI-compatible"**.

---

## 6. Builtin Model Catalog (Per Provider)

Model-model ini diisi oleh `BUILTIN_PROVIDERS` di `src/config/constants.js`
dan merupakan **single source of truth** — tidak ada daftar lain.

### Gemini (adapter: `GeminiClient`)

| Model | Catatan |
|-------|---------|
| `gemini-2.5-flash` | **Default** — cepat, efisien, kapabilitas tinggi |
| `gemini-2.5-pro` | Paling powerful, terbaik untuk reasoning kompleks |
| `gemini-1.5-flash` | Ringan, sangat cepat |
| `gemini-1.5-pro` | Kapabilitas tinggi versi 1.5 |
| `gemini-2.0-flash` | Varian flash terbaru v2.0 |

### OpenAI (adapter: `OpenAIClient` — juga dipakai provider custom OpenAI-compatible)

| Model | Catatan |
|-------|---------|
| `gpt-4o-mini` | **Default** — cepat dan hemat |
| `gpt-4o` | Paling powerful di keluarga GPT-4o |
| `gpt-4` | GPT-4 klasik |
| `gpt-3.5-turbo` | Legacy, cepat dan murah |

> **Catatan:** Provider custom (Groq, DeepSeek, dll.) menggunakan `OpenAIClient`
> tetapi model-modelnya tidak di-hardcode di `BUILTIN_PROVIDERS` — Anda mengelolanya
> sendiri via `tai model --add` / `tai model --set`.

---

## 7. Referensi API Internal (untuk Developer)

| Method | Lokasi | Tujuan |
|--------|--------|--------|
| `configMgr.getActiveModel(providerId)` | `src/config/manager.js` | Baca model aktif (canonical getter) |
| `configMgr.getModelCatalog(providerId)` | `src/config/manager.js` | Baca katalog model (canonical getter) |
| `configMgr.getProviderNames()` | `src/config/manager.js` | Daftar semua provider (builtin ∪ custom) |
| `configMgr.getProviderModels(id)` | `src/config/manager.js` | **Deprecated** — gunakan `getModelCatalog()` |
| `BUILTIN_PROVIDERS` | `src/config/constants.js` | Single source of truth model builtin |

> Lihat [`docs/REFACTOR_PROVIDER_MODEL_CLARITY.md`](./REFACTOR_PROVIDER_MODEL_CLARITY.md)
> untuk riwayat lengkap refactor yang menghasilkan getter eksplisit ini.

---

## 8. FAQ Singkat

**Q: Saya set `tai model --set gemini-2.5-pro`, tapi masih pakai flash. Kenapa?**
A: Pastikan tidak ada `--model` di perintah Anda (one-shot flag menimpa config).
   Cek juga env var — misalnya `OPENAI_MODEL` tidak relevan untuk provider `gemini`.

**Q: Apakah `--model` menyimpan perubahan?**
A: Tidak. `--model` selalu one-shot / transien. Gunakan `tai model --set <nama>` untuk persisten.

**Q: Bagaimana saya tahu model apa yang sedang aktif?**
A: Jalankan `tai model --list`. Model aktif ditandai dengan `▸ (active)`.

**Q: Bisakah saya menambahkan model yang tidak ada di katalog builtin?**
A: Ya. `tai model --add my-finetune-v1` akan menambahkannya ke katalog dan
   `tai model --set my-finetune-v1` akan mengaktifkannya. Model kustom ditandai
   "(not in builtin catalog — saved as custom)" di output.

**Q: Apakah format `config.json` berubah setelah refactor?**
A: Tidak. Format tersimpan tetap `{ model: "...", models: [...] }`.
   `activeModel` dan `catalog` hanya nama getter internal, bukan field di disk.
