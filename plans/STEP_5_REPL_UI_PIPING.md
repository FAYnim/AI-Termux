# Step 5: Interactive REPL, Output Rendering & UNIX Piping

Dokumen ini berisi panduan implementasi teknis untuk **Step 5** pada proyek **Termux AI CLI (`t-ai`)**.

---

## 1. Tujuan & Ruang Lingkup (Objectives & Scope)

Membangun antarmuka terminal yang kaya visual dan interaktif bagi pengembang di Termux Android. Modul ini mencakup antarmuka **Interactive REPL** (multi-turn dengan slash commands), mode **Single-Shot Execution**, dukungan **UNIX Piping** (`stdin` stream), **Markdown Renderer & Code Syntax Highlighter** murni berbasis ANSI (tanpa dependensi native besar), **Live Spinner status indicator**, serta penanganan sinyal **SIGINT (Ctrl+C)** yang elegan.

---

## 2. Spesifikasi Teknis & Struktur Berkas

### 2.1 Struktur Berkas yang Dibuat di Step 5
```
ai-termux/
├── src/
│   ├── cli/
│   │   ├── repl.js            # Interactive REPL session engine (node:readline)
│   │   ├── slash-commands.js  # REPL slash commands (/help, /model, /session, /clear, /exit)
│   │   ├── single-shot.js     # Direct command-line task execution runner
│   │   └── piping.js          # Stdin stream reader for UNIX pipe operations
│   └── ui/
│       ├── markdown.js        # Zero-dependency ANSI Markdown & Code syntax highlighter
│       ├── spinner.js         # Non-blocking terminal status indicator / spinner
│       └── box.js             # Terminal header boxes & status banners
└── tests/
    ├── step5-markdown.test.js # Unit test Markdown & syntax highlighter
    └── step5-piping.test.js   # Unit test stdin pipe processor
```

---

## 3. Detail Implementasi Modul

### 3.1 Interactive REPL (`src/cli/repl.js`)

* Menggunakan `node:readline/promises` bawaan Node.js.
* Menampilkan prompt kustom: `t-ai ❯ `.
* Mendukung riwayat perintah terminal (Arrow Up / Arrow Down).
* Integrasi dengan `AgentOrchestrator` dari Step 4 dalam mode berkelanjutan (*continuous session*).
* **Perintah Slash Bawaan (`src/cli/slash-commands.js`):**
  - `/help`: Menampilkan panduan dan daftar perintah slash.
  - `/model [nama]`: Menampilkan model aktif atau beralih ke model lain (misal: `/model gemini-2.5-pro`).
  - `/session`: Menampilkan ID sesi saat ini, token yang terpakai, dan direktori kerja.
  - `/clear`: Membersihkan tampilan layar terminal (`\x1b[2J\x1b[0f`).
  - `/config`: Menampilkan konfigurasi yang sedang aktif.
  - `/exit` atau `/quit`: Mengakhiri sesi REPL dengan aman.

---

### 3.2 Single-Shot Mode & UNIX Piping

#### Single-Shot Runner (`src/cli/single-shot.js`)
* Dipicu saat pengguna memberikan argumen langsung: `t-ai "refactor modul auth.js"`.
* Menjalankan orchestrator untuk 1 task hingga tuntas, mencetak output akhir, menyimpan sesi, dan keluar dengan exit code `0` (sukses) atau `1` (gagal).

#### UNIX Piping Handler (`src/cli/piping.js`)
* Mendeteksi ketersediaan data pada `process.stdin` (ketika `!process.stdin.isTTY`).
* Menggabungkan konten pipe dengan instruksi pengguna.
* Contoh penggunaan:
  ```bash
  cat /var/log/nginx/error.log | t-ai "analisis penyebab crash server ini"
  git diff | t-ai "buatkan pesan commit konvensional yang deskriptif"
  ```

---

### 3.3 Visual Terminal UI (`src/ui/`)

#### ANSI Markdown & Code Highlighter (`src/ui/markdown.js`)
* Parser markdown ringan murni tanpa modul C++:
  - **Headers:** `# Heading 1` -> Teks tebal berwarna Cyan/Kuning.
  - **Bold / Italic:** `**teks**` -> Bold ANSI codes.
  - **Lists:** `- item` / `1. item` -> Peluru berwarna dengan indentasi rapi.
  - **Blockquotes:** `> kutipan` -> Garis vertikal dengan teks abu-abu.
  - **Code Blocks:** ` ```js ... ``` ` -> Background gelap/kontras dengan highlight kata kunci (`const`, `function`, `return`, `import`, dll.) untuk JavaScript, Python, Bash, JSON, SQL, dan HTML.
  - **Inline Code:** `` `kode` `` -> Background abu-abu kontras.
  - **Tables:** Menampilkan tabel terminal bergaris batas bersih.

#### Live Spinner & Status Indicator (`src/ui/spinner.js`)
* Menampilkan animasi teks non-blocking saat agen sedang berpikir atau menjalankan tool:
  - `⠋ Menghubungi Gemini API...`
  - `⠙ Menjalankan tool [read_file: src/index.js]...`
  - `⠹ Mengeksekusi command [npm test]...`
* Menghentikan animasi secara bersih saat streaming teks dimulai agar tidak merusak tampilan markdown.

---

### 3.4 Penanganan Sinyal (SIGINT / Ctrl+C)

* Menangkap sinyal `process.on('SIGINT')`:
  - Jika agen sedang melakukan streaming LLM atau menjalankan perintah shell lokal, batalkan request/proses tersebut menggunakan `AbortController`.
  - Jangan mematikan proses REPL utama; kembali ke prompt `t-ai ❯ ` dengan pesan peringatan: `\n⚠ [Operasi dibatalkan oleh pengguna]`.
  - Jika pengguna menekan Ctrl+C dua kali berturut-turut dalam waktu 1 detik di saat idle, barulah REPL keluar sepenuhnya.

---

## 4. Pengujian & Verifikasi (Test Suite)

1. **Markdown & Syntax Highlighter Tests (`tests/step5-markdown.test.js`):**
   - Menguji konversi teks markdown umum ke ANSI sequences.
   - Menguji pewarnaan syntax code block untuk berbagai bahasa (JS, Bash, Python, JSON).
   - Menguji parsing tabel markdown menjadi tabel baris terminal.
2. **Piping & CLI Tests (`tests/step5-piping.test.js`):**
   - Menguji pembacaan stream buffer dari `process.stdin` tiruan.
   - Menguji penggabungan prompt piping dengan instruksi pengguna.
3. **Interactive REPL Manual Verification:**
   - Jalankan REPL, ketik `/help`, `/model`, `/clear`, `/exit`.
   - Jalankan REPL dan uji pembatalan dengan Ctrl+C saat agen sedang memproses.

---

## 5. Checklist Penyelesaian Step 5

- [ ] Antarmuka Interactive REPL berjalan mulus dengan navigasi history dan multi-line input.
- [ ] Seluruh perintah slash (`/help`, `/model`, `/session`, `/clear`, `/config`, `/exit`) berfungsi.
- [ ] Mode Single-Shot (`t-ai "prompt"`) berjalan mandiri dan mengembalikan exit code yang sesuai.
- [ ] Operasi UNIX Piping (`cat file | t-ai "prompt"`) membaca stdin dan memberikan analisis instan.
- [ ] Markdown renderer dan syntax highlighter menampilkan kode terminal dengan estetika tinggi.
- [ ] Live Spinner menampilkan indikator status tanpa mengganggu streaming teks.
- [ ] Penanganan sinyal Ctrl+C (SIGINT) membatalkan operasi turn tanpa menutup sesi REPL.
- [ ] Seluruh unit test Step 5 lulus (`npm test`).

---

## 6. Transisi ke Langkah Berikutnya

Setelah Step 5 selesai dan diverifikasi:
👉 **Lanjutkan ke [Step 6: End-to-End Integration, Termux Optimization & Packaging (STEP_6_INTEGRATION_TERMUX_PACKAGING.md)](./STEP_6_INTEGRATION_TERMUX_PACKAGING.md)**.
