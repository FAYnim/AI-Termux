# Step 1: Project Foundation, CLI Architecture & Configuration System

Dokumen ini berisi panduan implementasi teknis untuk **Step 1** pada proyek **Termux AI CLI (`t-ai`)**.

---

## 1. Tujuan & Ruang Lingkup (Objectives & Scope)

Membangun fondasi proyek Node.js berbasis ECMAScript Modules (ESM) murni dengan prinsip **Zero Native C-Binding**, menyediakan *entry point* CLI yang cepat (<300ms startup), parser argumen baris perintah ringan, sistem konfigurasi terpusat (`~/.t-ai/config.json`), dan utilitas logging / ANSI formatting.

---

## 2. Spesifikasi Teknis & Struktur Berkas

### 2.1 Struktur Berkas yang Dibuat di Step 1
```
ai-termux/
├── package.json               # Konfigurasi package Node.js ESM, bin: t-ai, tai
├── bin/
│   └── tai.js                 # Executable CLI entrypoint (#!/usr/bin/env node)
├── src/
│   ├── index.js               # Main library export
│   ├── cli/
│   │   ├── args.js            # Lightweight CLI flag & argument parser
│   │   └── help.js            # Dynamic help and version display
│   ├── config/
│   │   ├── constants.js       # Default constants, paths, fallback model name
│   │   └── manager.js         # Configuration loader/setter (~/.t-ai/config.json)
│   └── utils/
│       ├── ansi.js            # Zero-dependency ANSI color & style formatter
│       └── logger.js          # Leveled console logger (info, warn, error, debug, success)
└── tests/
    ├── step1-args.test.js     # Unit test untuk CLI argument parser
    └── step1-config.test.js   # Unit test untuk config manager
```

---

## 3. Detail Implementasi Modul

### 3.1 `package.json`
* Tipe: `"type": "module"`.
* Node.js Engine: `>= 18.0.0` (kompatibel dengan Node.js bawaan Termux: `pkg install nodejs`).
* Executable:
  ```json
  {
    "name": "termux-ai-cli",
    "version": "1.0.0",
    "description": "Autonomous AI Agent CLI optimized for Termux Android environment",
    "type": "module",
    "bin": {
      "t-ai": "./bin/tai.js",
      "tai": "./bin/tai.js"
    },
    "scripts": {
      "test": "node --test tests/*.test.js"
    }
  }
  ```
* **Catatan Kritis:** Jangan menambahkan paket yang memerlukan kompilasi C++ (`node-gyp`).

### 3.2 `src/config/constants.js`
* Direktori default: `~/.t-ai/` (pada Android Termux: `/data/data/com.termux/files/home/.t-ai/`).
* File konfigurasi: `~/.t-ai/config.json`.
* Direktori sesi: `~/.t-ai/sessions/`.
* Model Default: `gemini-2.5-flash` (cepat, hemat token, latency rendah).
* Default Execution Timeout: `30000` (30 detik).
* Default Max Context Tokens: `1000000`.

### 3.3 `src/config/manager.js`
* Fungsi utama:
  - `getConfigDir()`: Mendeteksi `process.env.T_AI_CONFIG_DIR` atau `~/.t-ai`.
  - `loadConfig()`: Membaca dan mem-parsing `config.json`. Jika belum ada, buat otomatis dengan konfigurasi default.
  - `saveConfig(data)`: Menyimpan konfigurasi secara aman (atomic write).
  - `getApiKey()`: Prioritas pembacaan API Key:
    1. Flag CLI `--api-key`
    2. Environment variable `GEMINI_API_KEY`
    3. File konfigurasi `~/.t-ai/config.json` (`apiKey`)
  - `get(key)`, `set(key, value)`, `list()`: Manajemen item konfigurasi individual.

### 3.4 `src/cli/args.js`
Parser ringan untuk menangani:
* Sub-commands: `config set <key> <val>`, `config get <key>`, `config list`, `resume <session-id>`.
* Flags:
  - `-m`, `--model <name>`: Override model AI aktif.
  - `-k`, `--api-key <key>`: Override API key untuk sesi saat ini.
  - `-s`, `--session <id>`: Melanjutkan sesi percakapan tertentu.
  - `-y`, `--yes`: Mode otomatis setuju (skip perizinan interaktif).
  - `-v`, `--version`: Menampilkan versi saat ini.
  - `-h`, `--help`: Menampilkan menu bantuan.
  - `--verbose`: Mode debug verbose.
* Positional Arguments: Prompt perintah langsung (misal: `t-ai "buatkan script python"`).

### 3.5 `src/utils/ansi.js` & `src/utils/logger.js`
* Format warna ANSI murni (tanpa chalk / kolorist untuk menjaga overhead < 0.1ms).
* Prefix visual: `ℹ [INFO]`, `✔ [SUCCESS]`, `⚠ [WARN]`, `✖ [ERROR]`, `⚡ [AGENT]`.

---

## 4. Pengujian & Verifikasi (Test Suite)

Gunakan Node.js built-in test runner (`node --test`):
1. **Arg Parser Tests (`tests/step1-args.test.js`):**
   - Menguji parsing flags `--model`, `-m`, `--api-key`, `-y`.
   - Menguji parsing subcommands `config set`, `config get`.
   - Menguji parsing multi-word positional prompt.
2. **Config Manager Tests (`tests/step1-config.test.js`):**
   - Menguji pembuatan otomatis direktori `~/.t-ai/`.
   - Menguji `getApiKey()` dari env vs file.
   - Menguji pembacaan dan penulisan nilai konfigurasi.
3. **Manual CLI Execution:**
   - Jalankan `node ./bin/tai.js --help` -> Menampilkan bantuan dalam <100ms.
   - Jalankan `node ./bin/tai.js --version` -> Menampilkan `termux-ai-cli v1.0.0`.
   - Jalankan `node ./bin/tai.js config set model gemini-2.5-pro` -> Sukses menyimpan.

---

## 5. Checklist Penyelesaian Step 1

- [x] `package.json` terkonfigurasi dengan `"type": "module"` dan `bin` paths.
- [x] `bin/tai.js` dapat dieksekusi secara mandiri dengan `chmod +x`.
- [x] `src/config/constants.js` dan `src/config/manager.js` berfungsi dengan baik.
- [x] `src/cli/args.js` mem-parsing seluruh variasi argumen tanpa error.
- [x] `src/utils/ansi.js` dan `src/utils/logger.js` mencetak output dengan rapi.
- [x] Seluruh unit test Step 1 lulus (`npm test`).

---

## 6. Transisi ke Langkah Berikutnya

Setelah Step 1 selesai dan diverifikasi:
👉 **Lanjutkan ke [Step 2: Security Guard & Local Actuator Tools (STEP_2_SECURITY_TOOLS.md)](./STEP_2_SECURITY_TOOLS.md)**.
