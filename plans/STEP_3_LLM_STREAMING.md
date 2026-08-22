# Step 3: LLM Client (Gemini API), SSE Streaming & Network Resilience

Dokumen ini berisi panduan implementasi teknis untuk **Step 3** pada proyek **Termux AI CLI (`termuxai`)**.

---

## 1. Tujuan & Ruang Lingkup (Objectives & Scope)

Membangun modul komunikasi LLM berbasis Google Gemini API menggunakan `fetch` murni bawaan Node.js (tanpa SDK besar dengan dependensi native). Modul ini mendukung **Server-Sent Events (SSE) streaming** untuk mengurangi persepsi latensi (*Time to First Token*), menangani *Function Calling* (deklarasi alat & serialisasi respon), serta menyediakan lapisan ketahanan jaringan (*Network Resilience*) dengan *exponential backoff retry* untuk mengatasi rate limit (HTTP 429) dan gangguan koneksi seluler.

---

## 2. Spesifikasi Teknis & Struktur Berkas

### 2.1 Struktur Berkas yang Dibuat di Step 3
```
ai-termux/
├── src/
│   └── llm/
│       ├── index.js           # Main LLM client entrypoint
│       ├── gemini.js          # REST API & SSE streaming communicator
│       ├── stream-parser.js   # Server-Sent Events (SSE) line-by-line parser
│       ├── retry.js           # Exponential backoff with jitter retry wrapper
│       └── types.js           # Message formats (User, Model, FunctionCall, FunctionResponse)
└── tests/
    ├── step3-stream.test.js   # Unit test SSE chunk parser
    └── step3-retry.test.js    # Unit test retry logic & exponential backoff
```

---

## 3. Detail Implementasi Modul

### 3.1 Gemini API Communicator (`src/llm/gemini.js`)

* **Endpoint Standar:**
  - Streaming: `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`
  - Non-streaming: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
* **Payload Structure:**
  ```json
  {
    "contents": [
      {
        "role": "user",
        "parts": [{ "text": "Buatkan file hello.js" }]
      }
    ],
    "tools": [
      {
        "functionDeclarations": [ /* Skema dari Step 2 */ ]
      }
    ],
    "generationConfig": {
      "temperature": 0.2,
      "maxOutputTokens": 8192
    },
    "systemInstruction": {
      "parts": [{ "text": "Anda adalah Termux AI CLI Agent..." }]
    }
  }
  ```
* **Metode Utama:**
  - `generateStream({ contents, tools, systemInstruction, onChunk, signal })`: Mengalirkan token teks secara langsung via callback `onChunk(token)` dan mengumpulkan `functionCalls` jika model memutuskan untuk memanggil alat.
  - `generate({ contents, tools, systemInstruction, signal })`: Mode sinkron/non-streaming untuk panggilan tunggal sederhana.

---

### 3.2 SSE Stream Parser (`src/llm/stream-parser.js`)

* Membaca `ReadableStream` dari Node.js `fetch` response body dalam bentuk chunk `Uint8Array`.
* Memecah buffer berdasarkan pembatas baris (`\n\n` atau `data: `).
* Mengekstrak JSON payload dari setiap event SSE `data: { ... }`.
* Menangani kasus potongan JSON yang terbelah antar paket jaringan (*chunk splitting*).
* Menghasilkan event:
  - `onToken(text)`: Teks markdown atau penjelasan dari model.
  - `onFunctionCall({ name, args })`: Panggilan alat yang diminta model.
  - `onFinish(reason)`: Status penyelesaian generasi (`STOP`, `MAX_TOKENS`, dll.).

---

### 3.3 Network Resilience & Retry Wrapper (`src/llm/retry.js`)

* **Kondisi Retry:**
  - HTTP 429: Too Many Requests (Rate Limit / Quota Spikes).
  - HTTP 503: Service Unavailable / High Load.
  - Kesalahan jaringan sementara: `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND` (sering terjadi pada jaringan seluler Android).
* **Algoritma Backoff:**
  ```javascript
  const delay = Math.min(initialDelayMs * Math.pow(2, attempt) + Math.random() * 500, maxDelayMs);
  ```
* Maksimal percobaan: 3 kali.
* Menampilkan notifikasi visual pada terminal: `⚠ [WARN] Jaringan sibuk (HTTP 429), mencoba kembali dalam 2.3s (Percobaan 1/3)...`.

---

### 3.4 Dukungan Dynamic Model Switching

* Pengguna dapat memilih model secara fleksibel melalui flag `--model` atau konfigurasi:
  - `gemini-2.5-flash` (Default, sangat cepat, efisien)
  - `gemini-2.5-pro` (Penalaran kompleks / refactoring skala besar)
  - `gemini-1.5-flash` / `gemini-1.5-pro` (Kompatibilitas mundur)

---

## 4. Pengujian & Verifikasi (Test Suite)

1. **SSE Parser Tests (`tests/step3-stream.test.js`):**
   - Menguji pemecahan chunk stream normal.
   - Menguji penanganan chunk yang terpotong di tengah JSON (`fragmented chunks`).
   - Menguji ekstraksi partisi ganda (teks + functionCall).
2. **Retry Engine Tests (`tests/step3-retry.test.js`):**
   - Menguji retry otomatis saat fungsi melempar error HTTP 429 simulasi.
   - Menguji kegagalan setelah batas maksimum retry tercapai (3x).
   - Menguji pemenuhan sinyal `AbortSignal` saat dibatalkan pengguna.

---

## 5. Checklist Penyelesaian Step 3

- [x] Klien Gemini API berbasis `fetch` murni berjalan tanpa paket eksternal besar.
- [x] SSE Stream Parser mampu mengalirkan token teks secara real-time dan menangkap pemanggilan fungsi (`functionCall`).
- [x] Mekanisme *Exponential Backoff Retry* berhasil memulihkan request saat simulasi 429/503.
- [x] Sinyal pembatalan (`AbortSignal` / Ctrl+C) menghentikan request HTTP secara instan.
- [x] Seluruh unit test Step 3 lulus (`npm test`).

---

## 6. Transisi ke Langkah Berikutnya

Setelah Step 3 selesai dan diverifikasi:
👉 **Lanjutkan ke [Step 4: ReAct Agentic Loop & Conversation State Engine (STEP_4_REACT_AGENT_SESSION.md)](./STEP_4_REACT_AGENT_SESSION.md)**.
