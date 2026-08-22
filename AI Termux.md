# Product Requirements Document (PRD): Termux AI CLI

---

## 1. Ringkasan Eksekutif & Identitas Proyek

* **Nama Produk:** Termux AI CLI (`termuxai`)
* **Tipe Produk:** Developer Tool / Command Line Interface (CLI) Agent
* **Lingkungan Target:** Android OS (via Termux Environment)
* **Runtime:** Node.js (ESM, Zero/Low Native Dependencies)
* **Status:** Inception & Architectural Blueprint (v1.0)

Termux AI CLI adalah perkakas baris perintah berbasis *autonomous agent* yang dirancang khusus untuk berjalan di lingkungan Termux Android. Sistem ini bertindak sebagai klien ringan (*thin client*) yang mendelegasikan proses penalaran kode dan pemecahan masalah ke LLM Cloud API (seperti Gemini API), sementara eksekusi berkas, inspeksi direktori, dan instruksi shell dijalankan secara langsung pada sistem berkas lokal perangkat.

---

## 2. Latar Belakang & Pernyataan Masalah

### 2.1 Problem Statement
1. **Inkompatibilitas Biner:** Perkakas AI CLI konvensional (misal: Claude CLI, Copilot CLI) didistribusikan dalam biner yang dikompilasi terhadap `glibc`, sedangkan Termux menggunakan `Bionic libc` Android.
2. **Ketergantungan Desktop:** Banyak CLI AI mengandalkan otentikasi GUI/browser desktop lokal (`localhost` callback redirection) yang sering terisolasi di sandbox Android.
3. **Beban Komputasi Lokal:** Menjalankan model AI atau *vector engine* lokal di perangkat ponsel menyebabkan *thermal throttling*, konsumsi RAM tinggi, dan pengurasan baterai ekstrem.

### 2.2 Value Proposition
* **Zero Native C-Binding:** Memastikan instalasi berjalan mulus melalui `npm` atau repositori skrip tanpa kebutuhan kompilasi biner `node-gyp`.
* **Full Local Actuation:** AI dapat membaca, menulis, merefaktor kode, dan mengeksekusi *command* pengujian langsung di penyimpanan internal ponsel.
* **Low Memory Footprint:** Konsumsi memori di bawah 50 MB RAM saat *idle* maupun saat menjalankan *agentic loop*.

---

## 3. Target Pengguna & Kasus Penggunaan

### 3.1 Target Pengguna
* Pengembang perangkat lunak yang melakukan *coding*, *debugging*, atau manajemen server darurat dari perangkat seluler.
* Administrator sistem yang mengelola repositori Git dan infrastruktur langsung melalui terminal Termux.

### 3.2 Kasus Penggunaan Utama
* **Eksplorasi & Modifikasi Kode Proyek:** Meminta AI membaca struktur folder, memahami dependensi proyek, dan menambahkan fitur baru ke file sumber tertentu.
* **Automated Bug Fixing (Self-Healing Loop):** AI menulis kode, menjalankan perintah tes/linter di shell Termux, menganalisis *error output*, dan merevisi kode secara otomatis sampai lulus uji.
* **Operasi UNIX Piping:** Menyalurkan *output* perintah terminal (seperti `cat access.log | termuxai "analisis IP mencurigakan"`) untuk mendapatkan ringkasan instan.

---

## 4. Arsitektur Sistem & Alur Kerja

Sistem mengadopsi model **ReAct (Reasoning + Acting) Agentic Loop**:


```
flowchart TD
    subgraph User_Layer ["User Interaction"]
        User["Pengguna (Input Task / Prompt)"]
        TermDisplay["Terminal Display (Markdown / Stream)"]
    end

    subgraph Client_Runtime ["Termux AI CLI (Node.js Thin Client)"]
        Orchestrator["Agent Orchestrator (REPL Engine)"]
        ContextMgr["Session & Context Manager"]
        SecCheck{"Security & Permission Guard"}
        Actuators["Local Actuators (node:fs / child_process)"]
    end

    subgraph Cloud_Service ["LLM Cloud Service"]
        LLM["Reasoning Engine (e.g. Gemini API)"]
    end

    %% Input Flow
    User -->|1. Input task/command| Orchestrator
    Orchestrator <-->|2. Kelola riwayat sesi| ContextMgr
    Orchestrator -->|3. Kirim request (Konteks + Tools Schema)| LLM

    %% LLM Decision Flow
    LLM -->|4a. Respon Teks Final| TermDisplay
    LLM -->|4b. Instruksi Tool Call (JSON)| Orchestrator

    %% Tool Execution Flow
    Orchestrator -->|5. Evaluasi parameter tool| SecCheck
    SecCheck -->|Perintah berbahaya: Minta konfirmasi y/N| User
    SecCheck -->|Aman / Diizinkan| Actuators

    %% Local I/O & Feedback Loop
    Actuators -->|6. Eksekusi File I/O / Shell Command di Termux| Actuators
    Actuators -->|7. Return output (stdout/data)| Orchestrator
    Orchestrator -->|8. Kirim Function Response (Loop ReAct)| LLM
```

```
sequenceDiagram
    autonumber
    actor User as Pengguna
    participant CLI as Termux AI CLI (Node.js)
    participant Sec as Security Guard
    participant Act as Local Actuator (I/O & Shell)
    participant API as LLM Cloud API

    User->>CLI: Masukkan perintah / task
    CLI->>CLI: Susun riwayat percakapan & definisi tools
    CLI->>API: HTTP Request (Prompt + Context + Tool Declarations)

    loop ReAct Agentic Loop
        alt Model Membutuhkan Aksi Lokal (Tool Call)
            API-->>CLI: Respon: functionCall(name, args)
            CLI->>Sec: Verifikasi keamanan command/path
            opt Perintah Berisiko (misal: write, execute_command)
                Sec->>User: Minta konfirmasi interaktif [y/N]
                User-->>Sec: Izin diberikan
            end
            Sec->>Act: Jalankan operasi (Read/Write File/Bash)
            Act-->>CLI: Kembalikan hasil eksekusi (stdout / data)
            CLI->>API: Kirim functionResponse (Hasil tool ke API)
        else Model Mengirimkan Jawaban Akhir (Text Output)
            API-->>CLI: Respon: Konten teks final (SSE / JSON)
            CLI-->>User: Tampilkan teks / Markdown ke terminal
        end
    end
```
---

## 5. Kebutuhan Fungsional (Functional Requirements)

### FR-1: Manajemen Sesi & Konteks
* Sistem harus mendukung mode **Interactive REPL** (percakapan multi-turn berkelanjutan) dan mode **Single-Shot Execution** (eksekusi satu perintah langsung dari argumen terminal).
* Sistem harus mengelola histori percakapan dalam memori dan menyediakannya dalam format penyimpanan lokal (`~/.termuxai/sessions/`).
* Sistem harus memiliki algoritma *Context Pruning* (pemangkasan histori lama jika akumulasi token mendekati batas maksimum konteks model).

### FR-2: Engine Eksekusi Alat (*Tool Execution Engine*)
* CLI harus menyediakan set fungsi bawaan (*core tool definitions*) yang diekspos ke API:
  * `read_file(filePath, startLine?, endLine?)`
  * `write_file(filePath, content)`
  * `patch_file(filePath, searchString, replaceString)` *(Diff patching untuk efisiensi)*
  * `list_dir(dirPath, recursive?)`
  * `execute_command(command, workingDir?)`

### FR-3: Sistem Keamanan & Konfirmasi Pengguna
* **Mode Interaktif / Human-in-the-Loop:** Setiap perintah shell yang berpotensi destruktif (seperti `rm`, `git reset`, modifikasi file sistem) wajib memicu *prompt* konfirmasi `[y/N]` kepada pengguna sebelum dieksekusi.
* **Safe-Path Boundary:** CLI secara *default* hanya boleh memodifikasi file di dalam direktori kerja aktif (*current working directory*) atau folder yang didefinisikan pengguna. Modifikasi di luar direktori tersebut harus ditolak secara eksplisit.
* **Timeout Execution:** Eksekusi perintah terminal lokal dibatasi waktu maksimum (default: 30 detik) guna mencegah *infinite loop* atau proses *hang*.

### FR-4: Output Rendering & Streaming
* Mendukung *streaming response* via Server-Sent Events (SSE) untuk mengurangi persepsi latensi (*Time to First Token*).
* Menampilkan *syntax highlighting* pada blok kode dan format Markdown langsung di antarmuka terminal.
* Menampilkan indikator visual yang jelas (*spinner/status badge*) saat model sedang memproses atau saat sistem lokal sedang menjalankan *tool*.

### FR-5: Konfigurasi & Model Switching
* Konfigurasi disimpan di `~/.termuxai/config.json`.
* Mendukung penggantian model dinamis melalui *flag* (contoh: `--model gemini-2.5-flash` atau `--model gemini-2.5-pro`).
* Manajemen API Key berbasis variabel lingkungan (`GEMINI_API_KEY`, `TERMUXAI_API_KEY`) atau file konfigurasi terenkripsi sederhana.

---

## 6. Kebutuhan Non-Fungsional (Non-Functional Requirements)

| Kategori | Spesifikasi |
|---|---|
| **Startup Time** | Waktu inisialisasi CLI dari perintah diketik hingga siap menerima input `< 300 ms`. |
| **Memory Footprint** | Konsumsi RAM tidak boleh melebihi `50 MB` pada Node.js runtime. |
| **Dependencies** | Mengutamakan modul bawaan Node.js (`node:fs`, `node:child_process`, `node:readline`). Menghindari library C++ native. |
| **Network Resilience** | Memiliki mekanisme *retry* eksponensial (maksimal 3 kali) saat terjadi kegagalan jaringan atau *rate limit* (HTTP 429/503). |
| **Portabilitas** | Kompatibel penuh dengan arsitektur ARM32, ARM64, dan x86_64 pada Termux Android 10+. |

---

## 7. Spesifikasi Alat Eksekusi Lokal (*Tool Specification*)

| Nama Tool | Parameter Input | Output Data | Kriteria Keamanan |
|---|---|---|---|
| `read_file` | `filePath` (string), `encoding` (string) | Isi file dalam bentuk teks | Read-only. Akses dibatasi pada path yang diizinkan. |
| `write_file` | `filePath` (string), `content` (string) | Konfirmasi status penulisan | Memerlukan konfirmasi jika menimpa file eksis di luar *safe zone*. |
| `patch_file` | `filePath` (string), `diff` / `search_replace` | Status patch berhasil/gagal | Mencegah penulisan ulang seluruh file besar; menghemat token. |
| `list_dir` | `dirPath` (string), `depth` (number) | Array pohon struktur direktori | Mengabaikan folder `.git` dan `node_modules` secara default. |
| `execute_command` | `command` (string), `timeoutMs` (number) | `stdout`, `stderr`, `exitCode` | Wajib konfirmasi interaktif untuk *command* non-idempotent. |

---

## 8. Matriks Risiko & Mitigasi

| Risiko | Dampak | Mitigasi Arsitektur |
|---|---|---|
| **Android OS Background Kill** | Sesi CLI terputus saat pengguna beralih aplikasi. | Simpan status state percakapan secara atomik ke disk lokal di setiap pergantian *turn*. |
| **Token Exhaustion (File Terlalu Besar)** | Request API ditolak karena *payload* melebihi batas token. | Implementasikan pembatasan pembacaan baris (`line chunking`) dan hindari membaca file biner. |
| **Perintah Shell Berbahaya / Hallucinated Command** | Kerusakan data lokal atau kehilangan file proyek. | Terapkan *blacklist* pola perintah ekstrem (`rm -rf /`, `mkfs`) dan validasi konfirmasi manual. |
| **Koneksi Seluler Tidak Stabil** | Request HTTP *streaming* putus di tengah jalan. | Tambahkan *abort controller*, penanganan sinyal `SIGINT` (Ctrl+C), dan mekanisme *auto-reconnect*. |

---

## 9. Roadmap Pengembangan

* **Fase 1 (MVP Foundation):**
  * Pengaturan struktur CLI berbasis Node.js ESM.
  * Implementasi komunikasi dasar ke Gemini API (non-streaming).
  * Pembuatan 3 alat dasar: `read_file`, `write_file`, `list_dir`.
  * Mode interaktif dasar (REPL).
* **Fase 2 (Agentic Enhancement & Security):**
  * Integrasi `execute_command` dengan sistem konfirmasi perizinan interaktif.
  * Implementasi *streaming output* (SSE) dan tampilan Markdown di terminal.
  * Penambahan penanganan error jaringan dan *retry logic*.
* **Fase 3 (Advanced Developer Features):**
  * Fitur *patching/diff editing* untuk penghematan token saat merefaktor file besar.
  * Dukungan *UNIX piping* (`stdin` / `stdout`).
  * Manajemen sesi persisten (`termuxai resume <session-id>`) dan *context pruning*.