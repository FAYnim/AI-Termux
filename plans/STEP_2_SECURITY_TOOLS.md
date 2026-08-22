# Step 2: Security Guard & Local Actuator Tools Engine

Dokumen ini berisi panduan implementasi teknis untuk **Step 2** pada proyek **Termux AI CLI (`termuxai`)**.

---

## 1. Tujuan & Ruang Lingkup (Objectives & Scope)

Membangun mesin eksekusi alat lokal (*Local Actuators*) yang memungkinkan AI berinteraksi dengan sistem berkas dan shell Termux secara aman dan terisolasi. Sistem ini dilengkapi dengan **Security Guard** untuk memvalidasi batas path aman (*safe-path boundary*), mendeteksi perintah shell berbahaya, meminta konfirmasi interaktif pengguna (*human-in-the-loop* `[y/N]`), dan membatasi durasi eksekusi perintah (*timeout guard*).

---

## 2. Spesifikasi Teknis & Struktur Berkas

### 2.1 Struktur Berkas yang Dibuat di Step 2
```
ai-termux/
├── src/
│   ├── security/
│   │   ├── guard.js           # Main security guard & confirmation prompter
│   │   ├── rules.js           # Blacklist patterns, risky command regexes, safe paths
│   │   └── path-validator.js  # Path traversal & workspace boundary checker
│   └── tools/
│       ├── index.js           # Tool registry & Gemini Function Declaration schemas
│       ├── read_file.js       # Tool: read file with line-range & binary detection
│       ├── write_file.js      # Tool: atomic safe write & auto-mkdir
│       ├── patch_file.js      # Tool: token-efficient search-and-replace / diff patch
│       ├── list_dir.js        # Tool: directory walker with ignore filter (.git, node_modules)
│       └── execute_command.js # Tool: child_process spawn with streaming/timeout
└── tests/
    ├── step2-security.test.js # Unit test untuk security guard & path validation
    └── step2-tools.test.js    # Unit test untuk 5 local actuator tools
```

---

## 3. Detail Implementasi Modul

### 3.1 Security Guard & Path Validator

#### Path Validator (`src/security/path-validator.js`)
* Memvalidasi path absolut dan relatif agar tidak keluar dari direktori kerja aktif (*Current Working Directory / CWD*) kecuali diizinkan secara eksplisit oleh pengguna.
* Mencegah *path traversal* (contoh: `../../../../etc/shadow` atau `/system/bin`).

#### Security Rules & Guard (`src/security/guard.js` & `rules.js`)
* **Blacklist Absolut (Ditolak Langsung tanpa Konfirmasi):**
  - `rm -rf /`, `rm -rf /*`, `mkfs.*`, `dd if=...`, `:(){ :|:& };:`, `chmod -R 777 /`, dll.
* **Perintah Berisiko (Wajib Konfirmasi `[y/N]`):**
  - Perintah penghapusan: `rm`, `unlink`, `rmdir`.
  - Operasi Git destruktif: `git reset --hard`, `git clean -f`, `git push --force`.
  - Modifikasi izin: `chmod`, `chown`.
  - Eksekusi skrip eksternal: `curl ... | bash`, `wget ... | sh`.
  - Penulisan/penimpaan file di luar safe boundary.
* **Mekanisme Konfirmasi Interaktif:**
  - Menampilkan ringkasan aksi: *"AI ingin menjalankan: `rm -rf ./temp` di `/data/data/...`. Lanjutkan? [y/N]: "*.
  - Jika flag `--yes` / `-y` aktif, aksi dalam safe path dapat dijalankan otomatis (kecuali blacklist absolut).

---

### 3.2 Implementasi 5 Core Tools

#### 1. `read_file` (`src/tools/read_file.js`)
* **Input Schema:**
  - `filePath` (string, required): Lokasi file relatif/absolut.
  - `startLine` (number, optional, 1-indexed): Baris awal pembacaan.
  - `endLine` (number, optional, 1-indexed): Baris akhir pembacaan.
  - `encoding` (string, optional, default: `'utf-8'`).
* **Fitur Keamanan:**
  - Deteksi binary file (misal: gambar, biner ELF, zip). Jika terdeteksi binary, kembalikan metadata ukuran dan peringatan "Binary file detected, cannot display as text".
  - Pembatasan ukuran maksimum pembacaan (default: 500 KB atau 1000 baris per panggilan) untuk mencegah token exhaustion pada LLM.

#### 2. `write_file` (`src/tools/write_file.js`)
* **Input Schema:**
  - `filePath` (string, required): Lokasi file tujuan.
  - `content` (string, required): Isi konten teks yang akan ditulis.
* **Fitur Keamanan:**
  - Otomatis membuat folder induk secara rekursif (`node:fs.mkdir({ recursive: true })`).
  - Penulisan aman (menulis ke file temporer lalu rename, mencegah file korup saat proses terputus).

#### 3. `patch_file` (`src/tools/patch_file.js`)
* **Input Schema:**
  - `filePath` (string, required): Lokasi file target.
  - `searchString` (string, required): Blok teks asli yang ingin diganti (harus unik).
  - `replaceString` (string, required): Blok teks baru pengganti.
* **Tujuan & Keuntungan:**
  - Menghemat token secara drastis saat memodifikasi file besar (AI tidak perlu menulis ulang 1000 baris kode hanya untuk mengubah 5 baris).
  - Melakukan validasi kesamaan teks sebelum penggantian. Jika `searchString` tidak ditemukan atau tidak unik, kembalikan pesan error yang informatif.

#### 4. `list_dir` (`src/tools/list_dir.js`)
* **Input Schema:**
  - `dirPath` (string, optional, default: `.`): Direktori yang ingin diperiksa.
  - `depth` (number, optional, default: `2`): Kedalaman rekursi.
* **Fitur:**
  - Mengabaikan folder `.git`, `node_modules`, `dist`, `.cache`, `.termuxai` secara default.
  - Menghasilkan format ringkas pohon direktori (Tree structure) beserta ukuran file dan tipe (file/folder).

#### 5. `execute_command` (`src/tools/execute_command.js`)
* **Input Schema:**
  - `command` (string, required): Perintah shell yang akan dijalankan.
  - `workingDir` (string, optional, default: CWD).
  - `timeoutMs` (number, optional, default: 30000 ms).
* **Fitur:**
  - Menggunakan `node:child_process.spawn` dengan shell default (`/bin/sh` di Termux).
  - Menangkap `stdout`, `stderr`, `exitCode`, dan durasi eksekusi.
  - Menghentikan proses secara otomatis jika melebihi batas waktu (*timeout abort*).
  - Menggunakan *output truncation* jika output terminal terlalu panjang (> 50 KB) untuk menghemat memori dan token.

---

### 3.3 Tool Registry & Gemini Function Declaration Schema (`src/tools/index.js`)

Modul ini mengekspos:
1. `getToolDeclarations()`: Menghasilkan array format `functionDeclarations` standar Google Gemini API:
   ```json
   {
     "name": "read_file",
     "description": "Read content of a file with optional line range",
     "parameters": {
       "type": "OBJECT",
       "properties": {
         "filePath": { "type": "STRING", "description": "Relative or absolute file path" },
         "startLine": { "type": "INTEGER", "description": "1-indexed starting line number" },
         "endLine": { "type": "INTEGER", "description": "1-indexed ending line number" }
       },
       "required": ["filePath"]
     }
   }
   ```
2. `dispatchToolCall(name, args, context)`: Memanggil implementasi tool yang sesuai setelah melalui `SecurityGuard`.

---

## 4. Pengujian & Verifikasi (Test Suite)

1. **Security Guard Tests (`tests/step2-security.test.js`):**
   - Menguji penolakan path traversal (misal: `../../etc/hosts`).
   - Menguji pemblokiran perintah blacklist (`rm -rf /`).
   - Menguji deteksi perintah berisiko (`rm test.txt`).
   - Menguji pembatasan timeout (perintah `sleep 60` dihentikan pada 2 detik dalam tes).
2. **Tools Unit Tests (`tests/step2-tools.test.js`):**
   - Menguji pembuatan file via `write_file`.
   - Menguji pembacaan file & line slicing via `read_file`.
   - Menguji modifikasi kode via `patch_file`.
   - Menguji penjelajahan folder via `list_dir` (memastikan `node_modules` terabaikan).
   - Menguji eksekusi shell command (`echo "hello"`) via `execute_command`.

---

## 5. Checklist Penyelesaian Step 2

- [x] Modul `SecurityGuard` dan `PathValidator` selesai dan mampu mencegah akses tidak sah.
- [x] Implementasi 5 tool inti (`read_file`, `write_file`, `patch_file`, `list_dir`, `execute_command`) selesai.
- [x] Mekanisme deteksi file binary dan line-range truncation pada `read_file` berfungsi.
- [x] Mekanisme `patch_file` berhasil mengganti substring unik tanpa merusak sisa file.
- [x] Generator `functionDeclarations` menghasilkan JSON Schema yang valid untuk Gemini API.
- [x] Seluruh unit test Step 2 lulus (`npm test`).

---

## 6. Transisi ke Langkah Berikutnya

Setelah Step 2 selesai dan diverifikasi:
👉 **Lanjutkan ke [Step 3: LLM Client, SSE Streaming & Network Resilience (STEP_3_LLM_STREAMING.md)](./STEP_3_LLM_STREAMING.md)**.
