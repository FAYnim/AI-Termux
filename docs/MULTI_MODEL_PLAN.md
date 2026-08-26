# Plan: Multi-Model Support per Provider & Enhanced `/model` Command

**Issue:** Saat ini command `/model` hanya menampilkan model aktif, tanpa daftar model yang tersedia per provider.
**Goal:** Setiap provider bisa memiliki banyak model, dan UI dapat menampilkan/switch di antaranya.

---

## Status Saat Ini (Current State)

### Data Storage Locations
| Item | Lokasi |
|------|--------|
| Config utama | `~/.t-ai/config.json` |
| Session files | `~/.t-ai/sessions/*.json` |
| Constants | `src/config/constants.js` |
| Slash commands | `src/cli/slash-commands.js` |
| Config manager | `src/config/manager.js` |

### Masalah Ditemukan
1. **`SUPPORTED_MODELS`** di `constants.js` hanya berisi Gemini models (hardcoded, tidak dinamis per provider):
   ```js
   // src/config/constants.js
   export const SUPPORTED_MODELS = [
     'gemini-2.5-flash',
     'gemini-2.5-pro',
     'gemini-1.5-flash',
     'gemini-1.5-pro',
     'gemini-2.0-flash'
   ];
   ```

2. **`BUILTIN_PROVIDERS`** hanya menyimpan default model tunggal, bukan array:
   ```js
   gemini: {
     defaultBaseUrl: 'https://generativelanguage.googleapis.com',
     defaultModel: 'gemini-2.5-flash',  // satu model saja
     envVars: [...]
   }
   ```

3. **`/model` slash command** hanya show current + set new value, tanpa list:
   ```js
   // src/cli/slash-commands.js line 98-117
   if (!newModel) {
     // Hanya tampilkan "Active model: xxx"
     stream.write(`\n${ansi.cyan('i')} Active model: ${ansi.bold(ansi.yellow(currentModel))}\n\n`);
     return { handled: true, action: 'model_info', message: currentModel };
   }
   ```

4. **Config structure** saat ini belum punya field `models[]` per provider.

---

## Rencana Implementasi (3 Phases)

---

### Phase 1: Quick Win — Schema + Display List

**Target:** Tambah struktur data dan tampilkan list model saat `/model` dijalankan tanpa argumen.

#### 1.1 Update `src/config/constants.js`
Tambahkan field `models` ke setiap builtin provider:

```js
export const BUILTIN_PROVIDERS = {
  gemini: {
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-2.5-flash',
    models: [
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-1.5-flash',
      'gemini-1.5-pro',
      'gemini-2.0-flash'
    ],
    envVars: ['GEMINI_API_KEY', 'TERMUXAI_API_KEY', 'T_AI_API_KEY'],
    envBaseUrlVars: [],
    envModelVars: [],
  },
  openai: {
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: [
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4',
      'gpt-3.5-turbo'
    ],
    envVars: ['OPENAI_API_KEY'],
    envBaseUrlVars: ['OPENAI_BASE_URL'],
    envModelVars: ['OPENAI_MODEL'],
  },
};
```

#### 1.2 Update `src/config/manager.js`
Tambahkan helper method baru:

```js
/**
 * Get available models for a provider
 * @param {string} providerId
 * @returns {string[]}
 */
getProviderModels(providerId) {
  const builtin = BUILTIN_PROVIDERS[providerId];
  const config = this.loadConfig();
  const stored = config.providers?.[providerId] || {};

  // Merge: builtin models + custom user overrides
  const allModels = [...(stored.models || [])];
  const builtinModels = builtin?.models || [];

  // Include default model even if not in list
  if (builtinModels.length > 0 && !allModels.includes(builtin.defaultModel)) {
    allModels.unshift(builtin.defaultModel);
  }

  // Add any extra models from stored config
  for (const m of builtinModels) {
    if (!allModels.includes(m)) allModels.push(m);
  }

  // Dedupe
  return [...new Set(allModels)];
}
```

#### 1.3 Update `src/cli/slash-commands.js` — `/model` command
Ubah behavior saat tanpa argumen menjadi menampilkan table/list:

```js
case 'model': {
  const newModel = args[0];
  if (!newModel) {
    // SHOW LIST of available models
    const act = (orchestrator && orchestrator.provider) || configMgr.get('activeProvider') || 'gemini';
    const activeModel = configMgr.getProviderConfig(act).model || 'unknown';
    const allModels = configMgr.getProviderModels(act);

    const lines = allModels.map((m, i) =>
      m === activeModel
        ? `  ${ansi.green('▸')} ${ansi.bold(ansi.yellow(m))} ${ansi.dim('(active)')}`
        : `    ${ansi.white(m)}`
    );

    // Also show other providers' models (optional - second section)
    const otherProviders = Object.keys(configMgr.loadConfig().providers || {});
    if (otherProviders.length > 1) {
      lines.push('');
      lines.push(ansi.dim('Other providers:'));
      for (const pid of otherProviders) {
        if (pid === act) continue;
        const pm = configMgr.getProviderModels(pid);
        lines.push(`  ${ansi.cyan(`${pid}:`)} ${pm.join(', ')}`);
      }
    }

    const box = renderBox(lines.join('\n'), {
      title: `Model (${act})`,
      borderColor: 'cyan',
      borderStyle: 'round',
      minWidth: 48
    });
    stream.write(`\n${box}\n\n`);
    return { handled: true, action: 'model_list' };
  }
  // ... logic set model tetap sama
}
```

**Expected output:**
```
╔══════════════════════════════════════════════╗
║              Model (nara)                    ║
╠══════════════════════════════════════════════╣
║   ▸ agnes-2.5-flash  (active)               ║
║      agnes-3-pro                             ║
║                                              ║
║   Other providers:                           ║
║   gemini: gemini-2.5-flash, gemini-2.5-pro   ║
║            gemini-1.5-flash                  ║
╚══════════════════════════════════════════════╝
```

#### 1.4 Migration — Auto-populate `models` saat provider ditambahkan
Update function `setProviderField` atau command `/provider add` untuk auto-set `models` dari builtin jika belum ada.

#### 1.5 Tests
- Tambah test di `tests/step1-config.test.js`
- Tambah test di `tests/step1-providers-config.test.js`

---

### Phase 2: Interactive TUI Menu

**Target:** User bisa navigasi dan pilih model dengan arrow keys.

#### 2.1 Pilih Dependency
Opsi ringan: `nprompt` atau `ink` (React-based). Untuk minimal dependency, gunakan `nprompt` atau built-in readline.

#### 2.2 Buat File Baru `src/ui/model-menu.js`
```js
// Interactive vertical menu dengan arrow keys
// Menampilkan semua provider + model mereka
// Active model ditandai ●
// Enter untuk select
```

#### 2.3 Integrasi ke `slash-commands.js`
Saat `/model` dipanggil tanpa argumen di REPL, jalankan interactive menu alih-alih text output.

---

### Phase 3: CLI Non-interactive Flags

**Target:** Bisa manage model dari command line tanpa masuk REPL.

#### 3.1 Update `src/cli/args.js`
Tambahkan flag support:
```js
flags.modelList = false;    // --list
flags.modelAll = false;     // --all  
flags.modelSet = null;      // --set <model>
```

#### 3.2新增 subcommand di `bin/tai.js`
```bash
# List models provider tertentu
tai model --list --provider nara

# List semua models semua provider
tai model --list --all

# Switch active model
tai model --set agnes-2.5-flash --provider nara
```

#### 3.3 CLI handler di `src/cli/index.js`
Route command ke fungsi yang sesuai.

---

## File yang Akan Diubah

| File | Perubahan |
|------|-----------|
| `src/config/constants.js` | Tambah field `models[]` ke BUILTIN_PROVIDERS |
| `src/config/manager.js` | Tambah method `getProviderModels()` |
| `src/cli/slash-commands.js` | Update case `'model'` untuk tampilkan list |
| `src/ui/model-menu.js` | **[NEW]** Interactive TUI menu |
| `src/cli/args.js` | Tambah flag `--list`, `--all`, `--set` |
| `src/cli/index.js` | Route new CLI commands |
| `tests/step1-providers-config.test.js` | Test new methods |
| `tests/e2e-session-resume.test.js` | Verify session model persistence |

---

## Checklist Implementation

### Phase 1
- [ ] Update `constants.js` — tambahkan `models[]` ke semua builtin provider
- [ ] Update `manager.js` — tambah method `getProviderModels()`
- [ ] Update `slash-commands.js` — case `/model` tanpa argumen tampilkan table
- [ ] Update `slash-commands.js` — case `/model <name>` tetap set model baru
- [ ] Test manual: jalankan `node bin/tai.js`, ketik `/model`
- [ ] Run tests: `npm test`

### Phase 2
- [ ] Install dependency (`nprompt` atau `ink`)
- [ ] Buat `src/ui/model-menu.js`
- [ ] Integrasikan ke slash-commands
- [ ] Test interaktivitas

### Phase 3
- [ ] Update `args.js` parser
- [ ] Buat CLI handler baru di `index.js`
- [ ] Test command line flags
- [ ] Update README & help text

---

## Notes & Considerations

1. **Backward compatibility:** Config lama tanpa field `models` harus tetap works. `getProviderModels()` harus fallback ke `defaultModel` saja.
2. **Custom providers:** Provider tambahan dari config user juga perlu support field `models`.
3. **Session persistence:** Session menyimpan `model` field — pastikan setelah switch model, session baru tetap pakai model baru.
4. **API key per model:** Beberapa provider butuh API key berbeda per model (jarang, tapi perlu dipertimbangkan).
