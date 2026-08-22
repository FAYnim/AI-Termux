# Audit File & Folder Tidak Dibutuhkan — ai-termux

> Tanggal: 2026-08-22 | Branch: main @ 3b348fb | Audit: very thorough

## Ringkasan Eksekutif

| Kategori | Jumlah | Tindakan |
|----------|--------|----------|
| Aman Hapus (HIGH) | 1 file | `rm nul` langsung |
| Perlu Verifikasi | 16 file | Jangan `rm` dari git, exclude dari `npm publish` via `package.json.files` |
| Missing (Perlu Dibuat) | 3 file | Buat baru, bukan hapus |
| Tidak Ada Aksi | 34 file `src/` aktif | Semua terhubung ke `bin/tai.js` |

---

## A. Aman Dihapus — HIGH Confidence

| Path | Ukuran | Alasan | Aksi |
|------|--------|--------|------|
| `nul` | 0 B | File kosong sisa redirect Windows `> nul` / `2>nul`. Tidak di-track git (`git ls-files` bersih), 0 referensi di kode. | `rm nul` |

---

## B. Perlu Verifikasi — Jangan Hapus Langsung

Eksklusi dari publish lebih aman daripada `rm` dari repo.

| Path | Ukuran | Alasan | Rekomendasi |
|------|--------|--------|-------------|
| `.git/opencode` | 40 B | Berisi hash `a743d167...` dari tooling opencode. Bukan file git standar. Akan recreate otomatis. | Hapus jika tidak pakai opencode memory |
| `docs/superpowers/plans/2026-08-22-rename-tai-to-termuxai.md` | 42 KB | Plan rename `t-ai` → `termuxai` sudah selesai (commit 7659ccf). Tidak di-import runtime. | Pindah ke `docs/archive/` atau exclude via `.npmignore` |
| `plans/MASTER_PLAN.md` | 9.8 KB | Roadmap dev, tidak ada import runtime | Exclude dari npm |
| `plans/STEP_1_FOUNDATION_CONFIG.md` | 5.9 KB | Spec step 1 | Exclude dari npm |
| `plans/STEP_2_SECURITY_TOOLS.md` | 8.3 KB | Spec step 2 | Exclude dari npm |
| `plans/STEP_3_LLM_STREAMING.md` | 5.6 KB | Spec step 3 | Exclude dari npm |
| `plans/STEP_4_REACT_AGENT_SESSION.md` | 6.8 KB | Spec step 4 | Exclude dari npm |
| `plans/STEP_5_REPL_UI_PIPING.md` | 6.7 KB | Spec step 5 | Exclude dari npm |
| `plans/STEP_6_INTEGRATION_TERMUX_PACKAGING.md` | 5.8 KB | Spec step 6 | Exclude dari npm |
| `src/index.js` | 17 baris | Barrel library `main` di package.json. Tidak di-import internal (`bin/tai.js` import langsung). | Keep jika publish sebagai library |
| `src/cli/index.js` | barrel | Hanya re-export, internal import langsung ke file | Keep / low priority |
| `src/agent/index.js` | barrel | Sama — orphan internal | Keep |
| `src/tools/index.js` | barrel | Sama | Keep |
| `src/llm/index.js` | barrel | Sama | Keep |
| `src/ui/index.js` | barrel | Sama | Keep |
| `tests/` (15 file) | ~30 KB | 12 unit + 3 e2e, tidak ada import runtime. Penting untuk CI (`npm test`) | Exclude dari npm, jangan hapus dari git |
| `bin/tai.js` (nama file) | 225 baris | Nama `tai.js` vs command `termuxai` mismatch intentional. Komentar baris 180 masih `t-ai`. | Jangan rename tanpa update `package.json.bin` |

> **Solusi publish:** Tambahkan di `package.json`:
> ```json
> "files": ["bin/", "src/", "install.sh", "README.md", "LICENSE"]
> ```

---

## C. Missing — Perlu Dibuat (Bukan Dihapus)

| Path | Status | Prioritas | Isi Rekomendasi |
|------|--------|-----------|-----------------|
| `.gitignore` | ABSENT | HIGH | `node_modules/`, `.benchmark-tmp/`, `coverage/`, `.termuxai/`, `nul`, `.DS_Store`, `Thumbs.db`, `*.log`, `dist/`, `build/` |
| `LICENSE` | ABSENT | HIGH | MIT License — `package.json` sudah declare MIT tapi file tidak ada, README badge broken |
| `.npmignore` atau `package.json.files` | ABSENT | HIGH | Tanpa whitelist, `npm pack` akan kirim `tests/`, `docs/`, `plans/`, `AI Termux.md` (>100KB) ke registry |

---

## D. Tidak Ada Aksi — Sudah Bersih

- **Dependencies:** 0 `dependencies`/`devDependencies` (zero native C-binding by design) — tidak ada unused deps
- **Build artifacts:** `dist/`, `build/`, `coverage/`, `node_modules/`, `.cache/` tidak ada
- **Config duplikat:** `.eslint*`, `tsconfig*`, `.prettier*` tidak ada (minimalis intentional)
- **Empty folders / cache / logs:** Tidak ditemukan
- **Dead code `src/`:** 34 file semua terhubung via import graph `bin/tai.js` → `orchestrator` → `llm/security/tools` — 0 orphan

## Checklist Tindakan

- [ ] `rm nul`
- [ ] Buat `.gitignore`
- [ ] Buat `LICENSE` (MIT)
- [ ] Tambah `package.json` → `"files": ["bin/","src/","install.sh","README.md","LICENSE"]`
- [ ] Verifikasi `.git/opencode` sebelum hapus
- [ ] Pindah `docs/superpowers/plans/*.md` ke `docs/archive/` (opsional)

*Generated: 2026-08-22 — Tool: explore subagent (very thorough)*
