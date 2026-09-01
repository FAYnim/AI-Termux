# Autocomplete Command & File Include — Design Spec

Date: 2026-09-01
Status: Approved
Repo: termux-ai-cli

## Context

REPL `termuxai` saat ini tidak punya assistensi input. Slash command harus diketik penuh
tanpa saran; tidak ada cara cepat mereferensikan file. CLI agent lain (mis. Claude Code)
menampilkan autocomplete `/command` dan saran file `@path` dengan navigasi arrow-key dan
Tab untuk select. Fitur ini menambah UX tersebut, zero-dependency, sesuai constraint
project (Termux Android, memori terbatas).

## Decisions (from brainstorming)

| # | Pertanyaan | Keputusan |
|---|------------|-----------|
| 1 | Aksi saat file dipilih | **Insert path saja** — LLM resolve sendiri via tool `read_file`. Tidak inline konten. |
| 2 | Cakupan `/` | **Command name saja** — tanpa subcommand/argumen dinamis. |
| 3 | Sumber daftar file | **`readdir` on-demand per segmen path** — tanpa index, tanpa cache. |
| 4 | Pengecualian file | **Skip hardcode: `node_modules`, `.git`, dotfiles** — tanpa parser `.gitignore`. |
| 5 | Kapan popup muncul | **Auto-popup** saat trigger `/` (awal baris) atau `@` (setelah spasi), seperti Claude Code. |
| 6 | Arsitektur | **Custom `PromptEditor` raw-mode** (pola `src/ui/model-menu.js`), bukan `readline` `completer` (Tab-only) dan bukan hack `beforeInput` (rapuh saat repaint). |

## Architecture

Tiga unit baru, satu titik integrasi:

```
src/cli/repl.js          → ganti rl.question() dengan promptLine()
src/ui/prompt-editor.js  → line editor raw-mode + render popup (UI only)
src/cli/autocomplete.js  → pure logic saran dari (text, cursor)
tests/autocomplete.test.js
```

### `src/cli/autocomplete.js` (pure, no streams)

```js
getSuggestions(text, cursor, ctx) → {
  kind: 'command' | 'file' | null,
  items: [{ value, label }],
  replaceStart, replaceEnd   // rentang teks yang diganti saat select
} | null
```

- ctx = `{ workingDir }`.
- **command**: trigger `/` di posisi 0 dan cursor belum melewati spasi pertama.
  Sumber: daftar cmd unik yang di-derive dari `SLASH_COMMANDS_HELP`
  (`src/cli/slash-commands.js:14`) — struktur help tidak diubah.
  Filter: prefix-match case-insensitive terhadap token setelah `/`.
- **file**: trigger `@` yang didahului awal-string atau whitespace; cursor di dalam token
  (tidak melewati whitespace penutup). Token setelah `@` diperlakukan sebagai path relatif
  terhadap `workingDir`.
  - Segmen terakhir yang belum selesai (`@src/cl`) → `readdirSync` dari folder induk
    (`src/`), filter prefix.
  - Segmen selesai dengan `/` (`@src/cli/`) → `readdirSync` folder itu, drill-down.
  - Entri directory diberi suffix `/` di `value`.
  - Skip: `node_modules`, `.git`, semua nama berawalan `.`.
  - `readdirSync` dibungkus try/catch → error = `items: []`.
- Tidak ada trigger → `null`.

### `src/ui/prompt-editor.js`

```js
promptLine({ input, output, prompt, getSuggestions, onCtrlC }) → Promise<string|null>
```

- **Non-TTY fallback**: jika `input.isTTY` false atau `getSuggestions` tidak diberikan →
  pakai `readline.createInterface` + `rl.question()` seperti sekarang. Test existing
  (`tests/session-status-repl.test.js`, e2e piping) tidak berubah perilaku.
- **Raw mode** (TTY): `input.setRawMode(true)` + `readline.emitKeypressEvents(input)` —
  pola identik `model-menu.js:155-262`. Cleanup `removeListener` + `setRawMode(false)`
  dijamin jalan di semua jalur exit (submit, Ctrl+C, stream close).
- Buffer internal: `text` + `cursor` (index). Mendukung left/right arrow, Home/End,
  backspace, delete, input printable multi-byte (pakai `key.sequence`).
  Single-line: Enter selalu submit.

**Keymap saat popup aktif:**

| Key | Aksi |
|-----|------|
| ↑ / ↓ | cycle selection (wrap, pola `model-menu.js`) |
| Tab / Enter | select item → insert, popup tetap terbuka kalau relevan (drill-down folder) |
| Esc | dismiss popup; popup baru muncul lagi saat token berubah |
| Ctrl+C | delegasi ke `onCtrlC` (logika double-Ctrl+C exit lama dari `repl.js:90`) |
| printable / backspace / arrows kiri-kanan | edit buffer; recompute suggestions setiap keystroke |

**Keymap saat popup tidak aktif:** Enter submit, Tab no-op (tidak insert spasi), sisanya edit normal.

**Select behavior:**
- Ganti `text[replaceStart..replaceEnd]` dengan `value`.
- Command → `value + ' '` (trailing space).
- File directory → `value` sudah ber-`/`, cursor di dalamnya, popup langsung recompute (drill-down).
- File → `value + ' '`.

### Rendering

Per keystroke: erase popup lama → hitung `getSuggestions` → render baris input → render
popup baru di bawahnya.

- Max 8 item terlihat; selection di luar window → scroll window mengikuti (panah ↓ di
  item terakhir menampilkan halaman berikutnya).
- Baris terpilih: `▸ ` + inverse video (`ansi` helper `src/utils/ansi.js`).
- Header kecil di popup file: path folder aktif, dim.
- Lebar popup dibatasi `output.columns` (default 80); label dipotong dengan `…`.
- Baris input yang lebih panjang dari terminal: potong dari kiri (scroll window),
  sederhana — tidak wrap. `ponytail:` ceiling = single visual line; upgrade path =
  wrap support kalau user report.

### Integrasi `repl.js`

```js
const rawInput = await promptLine({
  input, output,
  prompt: REPL_PROMPT,
  getSuggestions: (t, c) => getSuggestions(t, c, { workingDir: orchestrator.workingDir }),
  onCtrlC: () => { /* body SIGINT handler lama (repl.js:90-110) */ },
});
```

- Handler `rl.on('SIGINT')` lama dipindah menjadi callback `onCtrlC` — perilaku identik
  (abort saat busy, double-press exit, hint `ctrlCExitHint`).
- Wizard slash-command (`/provider add`) tidak berubah: `promptLine` sudah resolve saat
  Enter ditekan, jadi tidak ada listener editor yang aktif saat wizard berjalan.
  Wizard membuat readline sendiri seperti sekarang; `rl.pause/resume` di
  `repl.js:158/171` dihapus karena tidak lagi relevan.
- `isBusy` saat agent jalan: tidak ada prompt aktif, jadi tidak ada konflik.

## Error handling

- Semua I/O autocomplete try/catch → saran kosong, prompt tidak pernah crash.
- Raw mode selalu di-restore (finally/cleanup) di semua jalur exit.
- `output.columns` undefined → default 80.
- Non-TTY → fallback total ke jalur readline lama.

## Testing

`tests/autocomplete.test.js` (node:test + assert/strict, pola test existing):

- trigger: `/` pos 0 → command list; `/` di tengah kata → null; spasi setelah command → null.
- filter prefix case-insensitive; exact match tetap tampilkan command itu.
- `@` setelah spasi/awal → file; `email@host` → null (trigger harus word-initial).
- drill-down: `@src/` → isi `src/`; `@src/cl` → prefix filter.
- skip `node_modules`, `.git`, dotfiles (fixtures via `fs.mkdtempSync`).
- readdir error (path tidak ada) → `items: []`, tidak throw.
- `replaceStart/replaceEnd` benar untuk select di tengah string.

`prompt-editor` tidak dites unit (butuh TTY); dijamin oleh fallback non-TTY yang dipakai
test REPL existing + verifikasi manual via `npm run test:e2e` dan jalanin langsung.

## Out of scope

- Inline konten file (`@` hanya insert path).
- Autocomplete subcommand/argumen (`/provider add`, `/model <name>`).
- Fuzzy matching, caching index file, `.gitignore` parsing.
- Multi-line input.
