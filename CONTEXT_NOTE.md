# Context Note: ReAct Loop Improvement — Token Budget Check

> Tanggal: 2026-08-25
> Author: FAYnim / Agnes
> Status: Sudah di-commit di branch `feat/token-budget-check` (commit `b98951a`)
> Target: Masih direncanakan untuk implementasi selanjutnya

---

## Apa yang Sudah Dilakukan

### Opsi A — Token Budget Check ✅ SELESAI
Menambahkan preemptive check sebelum setiap iterasi ReAct loop:

**File:** `src/agent/orchestrator.js`

**Perubahan:**
- Import `estimateSessionTokens` dari `./pruner.js`
- Tambah "Step 0" di dalam `while` loop (`runTurn`) sebelum Step 1 (Context Pruning)
- Threshold: **85%** dari `maxContextTokens` (fallback 800k jika tidak dikonfigurasi)
- Log warn saat budget terlampaui: jumlah token terpakai vs limit

```js
// Step 0: Token Budget Check — stop before context overflows
const currentTokens = estimateSessionTokens(this.session);
const budgetLimit = Math.floor((this.maxContextTokens || 800000) * 0.85);
if (currentTokens > budgetLimit) {
  this.logger.warn(
    `Token budget exceeded (${currentTokens.toLocaleString()} / ${budgetLimit.toLocaleString()} tokens). ` +
    `Stopping ReAct loop at iteration ${currentIteration} to avoid context overflow.`
  );
  break;
}
```

**Hasil:** 180 unit tests tetap lulus, tidak ada regressi.

---

## Rencana Selanjutnya (Belum Diimplementasi)

### Opsi B — Reflection / Completion Check
AI menilai sendiri apakah task sudah selesai sebelum melanjutkan ke iterasi berikutnya.

**Konsep:**
Setiap N iterasi (misal每 3), jalankan reflection prompt ke LLM:

```
Task awal: {original_prompt}
Aksi yang sudah dilakukan: {recent_tool_calls_summary}
Status filesystem saat ini: {brief_snapshot}

Apakah task sudah selesai? (ya/tidak/mungkin)
Jika belum, apa langkah berikutnya?
```

**Keuntungan:** AI bisa berhenti lebih cepat jika sudah mencapai goal.
**Kekurangan:** Menambah latency dan biaya API per reflection call.
**Estimasi kompleksitas:** Sedang — perlu menambahkan state tracking recent actions dan reflection prompt builder.

**Implementasi target:**
1. Buat `ReflectionChecker` class baru di `src/agent/reflection.js`
2. Simpan history tool calls terakhir (misal 3-5 iterasi)
3. Insert reflection call setiap 3 iterasi
4. Parse response: jika "yes" → break, lanjutkan jika "no"/"maybe"

---

### Opsi D — Tool Call Pattern Detection
Mendeteksi loop berulang pada tool call yang sama (contoh: terus-menerus membaca file yang sama tanpa progress).

**Indikator terjebak:**
- Same tool name muncul berulang di N iterasi berturut-turut
- Same file path dibaca tanpa perubahan di antara nya
- No new files written setelah X iterasi

**Implementasi target:**
1. Track `(toolName, filePath)` pair per iterasi di orchestrator
2. Hitung unique pairs dalam sliding window (last 5 iterasi)
3. Jika unique count < threshold → flag `stuck`
4. Break dengan pesan yang jelas: "Terdeteksi stuck loop, hentikan."

**Estimasi kompleksitas:** Ringan — hanya perlu counter sederhana di orchestrator.

---

## Perbandingan Strategi (Dari Analisis Sebelumnya)

| Pendekatan | Kelebihan | Kekurangan | Estimasi Kerja |
|---|---|---|---|
| Hard Cap (sudah ada) | Sederhana, prediktibel | Bisa berhenti terlalu awal | — |
| Token Budget (✅ selesai) | Adaptif, hemat resource | Hanya preventif, tidak adaptif | — |
| Reflection Check | Paling cerdas, self-aware | Latency + biaya API tambahan | ⭐⭐⭐ Medium |
| Pattern Detection | Tanpa API extra call | Butuh state tracking | ⭐⭐ Ringan |

---

## Prioritas Rekomendasi

1. **Segera:** Opsi D (Pattern Detection) — ringan, tanpa biaya API tambahan
2. **Nanti:** Opsi B (Reflection) — paling powerful tapi butuh testing lebih matang

---

## Referensi: Cara Kerja AI Agent Lain

- **Claude Code**: Token budget + early stopping dari API `stop_reason`
- **AutoGPT/OpenDevin**: Reflection loop setiap N steps
- **SWE-agent**: Multi-agent split (reading agent, writing agent, testing agent)
- **Dify/LangChain**: Max steps + max tokens per response + cost tracking

---

## Quick Reference: Lokasi File Terkait

| Fitur | File |
|---|---|
| ReAct Orchestrator | `src/agent/orchestrator.js` |
| Token Estimator & Pruner | `src/agent/pruner.js` |
| Session Manager | `src/agent/session.js` |
| System Prompt | `src/agent/system-prompt.js` |
| Constants | `src/config/constants.js` |
| REPL | `src/cli/repl.js` |
| Slash Commands | `src/cli/slash-commands.js` |
