# Category 2: UX & Interaction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Deliver six UX & Interaction polish features (#7–12) that close the gap between faycli and Claude Code on terminal experience quality.

**Architecture:** Each feature is an isolated module or small extension to existing code. Features are ordered by dependency: thought-display toggle (#8) first; status-bar improvement (#12) last. All features integrate into the existing `repl.js` event loop without structural changes.

**Tech Stack:** Node.js ≥20 ESM, zero external deps, `node:readline`, `node:test` + `node:assert/strict`.

---

## Feature Map

| # | Feature | New Files | Modified Files |
|---|---------|-----------|----------------|
| #7 | Polished multi-turn prompt (turn badge) | `src/ui/history-indicator.js` | `src/cli/repl.js` |
| #8 | Thought/reasoning display toggle | `src/ui/thought-display.js`, `tests/thought-display.test.js` | `src/cli/repl.js`, `src/cli/single-shot.js`, `src/cli/slash-commands.js`, `locales/en.json`, `locales/id.json` |
| #9 | Inline diff preview before patch | `src/ui/diff-preview.js`, `tests/diff-preview.test.js` | `src/security/guard.js` |
| #10 | Keyboard shortcut overlay (`?` key) | `src/ui/shortcut-overlay.js`, `tests/shortcut-overlay.test.js` | `src/cli/repl.js` |
| #11 | Quick-fix suggestions after agent turn | `src/ui/quick-fix.js`, `tests/quick-fix.test.js` | `src/cli/repl.js` |
| #12 | Improved context window usage bar | — | `src/ui/box.js`, `tests/status-line.test.js` |

---

## Task 1: Thought/Reasoning Display Toggle (#8)

**Files:**
- Create: `src/ui/thought-display.js`
- Create: `tests/thought-display.test.js`
- Modify: `src/cli/repl.js` (onToken handler, slash command context)
- Modify: `src/cli/single-shot.js` (onToken handler)
- Modify: `src/cli/slash-commands.js` (SLASH_COMMANDS_HELP + new case)
- Modify: `locales/en.json`, `locales/id.json`

- [x] **Step 1: Write failing tests for thought-display module**

```js
// tests/thought-display.test.js
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  createThoughtDisplay,
  extractThoughtBlocks,
  stripThoughtBlocks,
} from '../src/ui/thought-display.js';

describe('extractThoughtBlocks', () => {
  test('extracts text inside <think> tags', () => {
    const result = extractThoughtBlocks('hello <think>deep reasoning</think> world');
    assert.deepEqual(result, ['deep reasoning']);
  });
  test('returns empty array when no think tags', () => {
    assert.deepEqual(extractThoughtBlocks('plain text'), []);
  });
  test('handles multiple think blocks', () => {
    const result = extractThoughtBlocks('<think>a</think> mid <think>b</think>');
    assert.deepEqual(result, ['a', 'b']);
  });
  test('handles multiline think blocks', () => {
    const result = extractThoughtBlocks('<think>\nline1\nline2\n</think>');
    assert.deepEqual(result, ['\nline1\nline2\n']);
  });
});

describe('stripThoughtBlocks', () => {
  test('removes <think> tags and content', () => {
    assert.equal(stripThoughtBlocks('hello <think>ignore</think> world'), 'hello  world');
  });
  test('no-op when no think tags', () => {
    assert.equal(stripThoughtBlocks('plain'), 'plain');
  });
});

describe('createThoughtDisplay', () => {
  test('starts disabled', () => {
    const td = createThoughtDisplay({ stream: { write: () => {} } });
    assert.equal(td.isEnabled(), false);
  });
  test('toggle flips state', () => {
    const td = createThoughtDisplay({ stream: { write: () => {} } });
    td.toggle(); assert.equal(td.isEnabled(), true);
    td.toggle(); assert.equal(td.isEnabled(), false);
  });
  test('processToken strips think block when disabled', () => {
    const written = [];
    const td = createThoughtDisplay({ stream: { write: (s) => written.push(s) } });
    const result = td.processToken('<think>reasoning</think>actual text');
    assert.equal(result, 'actual text');
    assert.equal(written.length, 0);
  });
  test('processToken prints thought when enabled', () => {
    const written = [];
    const td = createThoughtDisplay({ stream: { write: (s) => written.push(s) } });
    td.toggle();
    td.processToken('<think>my reasoning</think>answer');
    assert.ok(written.join('').includes('my reasoning'));
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `node --test tests/thought-display.test.js`
Expected: `ERR_MODULE_NOT_FOUND`

- [x] **Step 3: Implement `src/ui/thought-display.js`**

```js
/**
 * Thought/Reasoning Display Toggle
 * Toggled via /thoughts slash command.
 * When enabled: strips <think> from stream AND prints content dimmed.
 * When disabled: strips silently (preserving existing behavior).
 */
import { ansi } from '../utils/ansi.js';

const THINK_RE = /<think>([\s\S]*?)<\/think>/gi;

export function extractThoughtBlocks(text) {
  if (typeof text !== 'string') return [];
  const result = [];
  let match;
  THINK_RE.lastIndex = 0;
  while ((match = THINK_RE.exec(text)) !== null) result.push(match[1]);
  return result;
}

export function stripThoughtBlocks(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '');
}

export function createThoughtDisplay({ stream }) {
  let enabled = false;
  return {
    isEnabled() { return enabled; },
    toggle() { enabled = !enabled; return enabled; },
    processToken(token) {
      if (!token) return token;
      if (enabled) {
        for (const thought of extractThoughtBlocks(token)) {
          const trimmed = thought.trim();
          if (trimmed) stream.write(`${ansi.dim(ansi.italic(`\uD83D\uDCAD ${trimmed}`))}\n`);
        }
      }
      return stripThoughtBlocks(token);
    },
  };
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `node --test tests/thought-display.test.js`
Expected: all tests PASS

- [x] **Step 5: Add `/thoughts` slash command to `src/cli/slash-commands.js`**

Add to `SLASH_COMMANDS_HELP` array (after `/compact` entry):
```js
{ cmd: '/thoughts', desc: 'Toggle display of LLM reasoning/thought steps (hidden by default)' },
```

Add new case before `case 'clear':`:
```js
case 'thoughts': {
  if (!context.thoughtDisplay) {
    stream.write(`\n${ansi.yellow('\u26A0')} Thought display not available in this context.\n\n`);
    return { handled: true, action: 'thoughts_error', error: true };
  }
  const nowEnabled = context.thoughtDisplay.toggle();
  stream.write(`\n${ansi.cyan('\u2139')} Thought display: ${nowEnabled ? ansi.green('ON') : ansi.dim('OFF')}\n\n`);
  return { handled: true, action: 'thoughts_toggle', enabled: nowEnabled };
}
```

- [x] **Step 6: Wire thought-display into `src/cli/repl.js`**

Add import:
```js
import { createThoughtDisplay } from '../ui/thought-display.js';
```

After `let activeSpinner = null;` add:
```js
const thoughtDisplay = createThoughtDisplay({ stream: output });
```

Replace `onToken` callback body:
```js
onToken: (token) => {
  const clean = thoughtDisplay.processToken(
    token.replace(/<\/?(?:tool_calls?|function_call|tool_sep)[^>]*>/gi, ''),
  );
  if (!clean) return;
  if (spinner.isSpinning()) spinner.stop();
  if (!hasStreamedToken) { hasStreamedToken = true; output.write('\n'); }
  output.write(clean);
},
```

Add `thoughtDisplay` to the `executeSlashCommand` context object:
```js
const slashResult = await executeSlashCommand(line, {
  orchestrator, configMgr, logger, stream: output, input,
  thoughtDisplay,
  onWizardActive: (active) => { _wizardActive = active; },
});
```

- [x] **Step 7: Wire thought-display into `src/cli/single-shot.js`**

Add import:
```js
import { createThoughtDisplay } from '../ui/thought-display.js';
```

After `const spinner = createSpinner({ stream });` add:
```js
const thoughtDisplay = createThoughtDisplay({ stream });
```

Replace `onToken` callback body:
```js
onToken: (token) => {
  const clean = thoughtDisplay.processToken(
    token.replace(/<\/?(?:tool_calls?|function_call|tool_sep)[^>]*>/gi, ''),
  );
  if (!clean) return;
  if (spinner.isSpinning()) spinner.stop();
  if (streamTokens) {
    if (!hasStreamedToken) { hasStreamedToken = true; stream.write('\n'); }
    stream.write(clean);
    streamedText += clean;
  }
},
```

- [x] **Step 8: Add locale keys**

`locales/en.json` — add before closing `}`:
```json
"thoughtsOn": "Thought display: ON — LLM reasoning will be shown dimmed",
"thoughtsOff": "Thought display: OFF — LLM reasoning will be hidden"
```

`locales/id.json` — add before closing `}`:
```json
"thoughtsOn": "Tampilan pikiran: AKTIF — langkah penalaran LLM akan ditampilkan redup",
"thoughtsOff": "Tampilan pikiran: NONAKTIF — langkah penalaran LLM akan disembunyikan"
```

- [x] **Step 9: Run full test suite**

Run: `node --test tests/*.test.js`
Expected: all tests PASS

- [x] **Step 10: Commit**

```bash
git add src/ui/thought-display.js tests/thought-display.test.js \
  src/cli/repl.js src/cli/single-shot.js src/cli/slash-commands.js \
  locales/en.json locales/id.json
git commit -m "feat(ui): add thought/reasoning display toggle (/thoughts slash command)"
```

---

## Task 2: Keyboard Shortcut Reference Overlay (#10)

**Files:**
- Create: `src/ui/shortcut-overlay.js`
- Create: `tests/shortcut-overlay.test.js`
- Modify: `src/cli/repl.js`

- [x] **Step 1: Write failing tests**

```js
// tests/shortcut-overlay.test.js
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildShortcutOverlay, SHORTCUT_ENTRIES } from '../src/ui/shortcut-overlay.js';
import { stripAnsi } from '../src/utils/ansi.js';

describe('buildShortcutOverlay', () => {
  test('returns non-empty string', () => {
    const result = buildShortcutOverlay();
    assert.ok(typeof result === 'string' && result.length > 0);
  });
  test('contains all shortcut key labels', () => {
    const result = stripAnsi(buildShortcutOverlay());
    for (const entry of SHORTCUT_ENTRIES) {
      assert.ok(result.includes(entry.key), `missing key: ${entry.key}`);
    }
  });
  test('output contains title', () => {
    assert.ok(stripAnsi(buildShortcutOverlay()).includes('Keyboard Shortcuts'));
  });
});

describe('SHORTCUT_ENTRIES', () => {
  test('each entry has key and desc strings', () => {
    for (const e of SHORTCUT_ENTRIES) {
      assert.ok(typeof e.key === 'string' && e.key.length > 0);
      assert.ok(typeof e.desc === 'string' && e.desc.length > 0);
    }
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `node --test tests/shortcut-overlay.test.js`
Expected: `ERR_MODULE_NOT_FOUND`

- [x] **Step 3: Implement `src/ui/shortcut-overlay.js`**

```js
/**
 * Keyboard Shortcut Reference Overlay
 * Shown when user types '?' at idle REPL prompt.
 */
import { renderBox } from './box.js';
import { ansi } from '../utils/ansi.js';

export const SHORTCUT_ENTRIES = [
  { key: '?',          desc: 'Show this keyboard shortcut reference' },
  { key: 'Ctrl+C',    desc: 'Cancel running agent turn' },
  { key: 'Ctrl+C x2', desc: 'Exit REPL (press twice within 1s)' },
  { key: 'Tab',        desc: 'Autocomplete slash command or @file path' },
  { key: 'Up / Down',  desc: 'Navigate autocomplete suggestions' },
  { key: 'Esc',        desc: 'Dismiss autocomplete popup' },
  { key: 'Left/Right', desc: 'Move cursor in input line' },
  { key: 'Home / End', desc: 'Jump to start / end of input' },
  { key: '/help',      desc: 'Show all slash commands' },
  { key: '/model',     desc: 'Interactive model picker' },
  { key: '/session',   desc: 'Show session token usage stats' },
  { key: '/compact',   desc: 'Manually compact context window' },
  { key: '/thoughts',  desc: 'Toggle LLM reasoning display' },
  { key: '/clear',     desc: 'Clear terminal screen' },
  { key: '/exit',      desc: 'Exit the REPL session' },
];

export function buildShortcutOverlay() {
  const maxKeyLen = SHORTCUT_ENTRIES.reduce((m, e) => Math.max(m, e.key.length), 0);
  const lines = SHORTCUT_ENTRIES.map(({ key, desc }) => {
    const pad = ' '.repeat(Math.max(0, maxKeyLen - key.length));
    return `  ${ansi.cyanBright(key)}${pad}  ${ansi.dim('\u2500')}  ${ansi.white(desc)}`;
  });
  return renderBox(lines.join('\n'), {
    title: 'Keyboard Shortcuts',
    borderStyle: 'round',
    borderColor: 'cyan',
    minWidth: 50,
  });
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `node --test tests/shortcut-overlay.test.js`
Expected: all tests PASS

- [x] **Step 5: Wire `?` into `src/cli/repl.js`**

Add import:
```js
import { buildShortcutOverlay } from '../ui/shortcut-overlay.js';
```

In main loop, after `const line = (rawInput || '').trim();` and before slash-command check:
```js
if (line === '?') {
  output.write(`\n${buildShortcutOverlay()}\n\n`);
  continue;
}
```

- [x] **Step 6: Run full test suite**

Run: `node --test tests/*.test.js`
Expected: all tests PASS

- [x] **Step 7: Commit**

```bash
git add src/ui/shortcut-overlay.js tests/shortcut-overlay.test.js src/cli/repl.js
git commit -m "feat(ui): add keyboard shortcut overlay on '?' key"
```

---

## Task 3: Inline Diff Preview Before Applying Patch (#9)

**Files:**
- Create: `src/ui/diff-preview.js`
- Create: `tests/diff-preview.test.js`
- Modify: `src/security/guard.js`

- [x] **Step 1: Explore patch tool**

Run: `cat src/tools/patch.js`

Understand what `args` the tool layer passes to `guard.authorize('patch_file', args)`. The guard currently only validates paths. We attach `args._beforeContent` and `args._afterContent` from the tool layer to show the diff before prompting.

- [x] **Step 2: Write failing tests**

```js
// tests/diff-preview.test.js
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildDiffLines, renderDiffPreview } from '../src/ui/diff-preview.js';
import { stripAnsi } from '../src/utils/ansi.js';

describe('buildDiffLines', () => {
  test('marks added lines with +', () => {
    assert.ok(buildDiffLines('', 'hello\nworld\n').some((l) => l.startsWith('+')));
  });
  test('marks removed lines with -', () => {
    assert.ok(buildDiffLines('hello\nworld\n', '').some((l) => l.startsWith('-')));
  });
  test('unchanged lines get space prefix', () => {
    assert.ok(buildDiffLines('same\n', 'same\n').every((l) => l.startsWith(' ')));
  });
  test('identical content: all space-prefix', () => {
    assert.ok(buildDiffLines('abc\n', 'abc\n').every((l) => l.startsWith(' ')));
  });
});

describe('renderDiffPreview', () => {
  test('returns non-empty string', () => {
    const out = renderDiffPreview({ filePath: 'a.js', before: 'old\n', after: 'new\n' });
    assert.ok(typeof out === 'string' && out.length > 0);
  });
  test('contains filePath in output', () => {
    const out = stripAnsi(renderDiffPreview({ filePath: 'foo/bar.js', before: '', after: 'x\n' }));
    assert.ok(out.includes('foo/bar.js'));
  });
  test('shows + for added lines', () => {
    assert.ok(renderDiffPreview({ filePath: 'x.js', before: '', after: 'added\n' }).includes('+'));
  });
  test('shows - for removed lines', () => {
    assert.ok(renderDiffPreview({ filePath: 'x.js', before: 'removed\n', after: '' }).includes('-'));
  });
});
```

- [x] **Step 3: Run tests to verify they fail**

Run: `node --test tests/diff-preview.test.js`
Expected: `ERR_MODULE_NOT_FOUND`

- [x] **Step 4: Implement `src/ui/diff-preview.js`**

```js
/**
 * Inline Diff Preview Component
 * LCS-based line diff; zero external dependencies.
 */
import { ansi } from '../utils/ansi.js';

export function buildDiffLines(before, after) {
  const aLines = before.split('\n');
  const bLines = after.split('\n');
  const m = aLines.length;
  const n = bLines.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = aLines[i] === bLines[j]
        ? 1 + dp[i + 1][j + 1]
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const result = [];
  let i = 0; let j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && aLines[i] === bLines[j]) {
      result.push(` ${aLines[i]}`); i++; j++;
    } else if (j < n && (i >= m || dp[i + 1][j] <= dp[i][j + 1])) {
      result.push(`+${bLines[j]}`); j++;
    } else {
      result.push(`-${aLines[i]}`); i++;
    }
  }
  return result;
}

export function renderDiffPreview({ filePath, before, after, maxLines = 40 }) {
  const lines = buildDiffLines(before, after);
  const total = lines.length;
  const visible = lines.slice(0, maxLines);
  const colored = visible.map((line) =>
    line.startsWith('+') ? ansi.green(line)
    : line.startsWith('-') ? ansi.red(line)
    : ansi.dim(line)
  );
  if (total > maxLines) colored.push(ansi.dim(`  \u2026 ${total - maxLines} more lines \u2026`));
  const cols = (typeof process !== 'undefined' && process.stdout?.columns) || 80;
  const rule = ansi.dim('\u2500'.repeat(Math.min(60, cols - 2)));
  const header = `${ansi.bold(ansi.yellow('\uD83D\uDCC4 Diff Preview:'))} ${ansi.cyan(filePath)}`;
  return `\n${header}\n${rule}\n${colored.join('\n')}\n${rule}\n`;
}
```

- [x] **Step 5: Run tests to verify they pass**

Run: `node --test tests/diff-preview.test.js`
Expected: all tests PASS

- [x] **Step 6: Wire diff preview into `src/security/guard.js`**

Add import at top:
```js
import { renderDiffPreview } from '../ui/diff-preview.js';
```

Add `this._stream = options.stream || null;` to the constructor (after `this.onAfterConfirm = ...`).

Extract `patch_file` from the combined `case 'read_file': case 'write_file': case 'patch_file':` block into its own case placed **above** the combined block, then remove `'patch_file'` from the combined block:

```js
case 'patch_file': {
  const filePath = args.filePath;
  if (!filePath || typeof filePath !== 'string') {
    return { allowed: false, reason: 'File path must be a non-empty string.' };
  }
  const pathValidation = validateSafePath(filePath, this.baseDir, this._pathOptions());
  if (!pathValidation.isAllowed && !this.autoApprove) {
    const confirmed = await this.promptConfirmation({
      description: 'AI ingin menulis/mengubah file di luar workspace:',
      target: pathValidation.resolvedPath,
      question: 'Apakah anda mengizinkannya?',
    });
    if (!confirmed) {
      return { allowed: false, reason: `User rejected file access outside workspace for "${filePath}".` };
    }
  }
  if (!this.autoApprove && args._beforeContent !== undefined && args._afterContent !== undefined) {
    const preview = renderDiffPreview({
      filePath: pathValidation.resolvedPath || filePath,
      before: args._beforeContent,
      after: args._afterContent,
    });
    if (this.onBeforeConfirm) this.onBeforeConfirm();
    (this._stream || process.stdout).write(preview);
    const confirmed = await this.promptConfirmation({
      description: 'AI ingin menerapkan patch pada file:',
      target: pathValidation.resolvedPath || filePath,
      question: 'Apakah anda mengizinkan perubahan ini?',
    });
    if (this.onAfterConfirm) this.onAfterConfirm(confirmed);
    if (!confirmed) return { allowed: false, reason: `User rejected patch on "${filePath}".` };
  }
  return { allowed: true, resolvedPath: pathValidation.resolvedPath };
}
```

- [x] **Step 7: Run full test suite**

Run: `node --test tests/*.test.js`
Expected: all tests PASS

- [x] **Step 8: Commit**

```bash
git add src/ui/diff-preview.js tests/diff-preview.test.js src/security/guard.js
git commit -m "feat(ui): add inline diff preview before patch_file confirmation"
```

---

## Task 4: Quick-Fix Suggestions After Agent Response (#11)

**Files:**
- Create: `src/ui/quick-fix.js`
- Create: `tests/quick-fix.test.js`
- Modify: `src/cli/repl.js`

- [x] **Step 1: Write failing tests**

```js
// tests/quick-fix.test.js
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { deriveQuickFixes, renderQuickFixBar } from '../src/ui/quick-fix.js';
import { stripAnsi } from '../src/utils/ansi.js';

describe('deriveQuickFixes', () => {
  test('suggests run tests when write_file was used', () => {
    const fixes = deriveQuickFixes({ toolCalls: [{ name: 'write_file' }], text: '' });
    assert.ok(fixes.some((f) => f.label.toLowerCase().includes('test')));
  });
  test('suggests git commit when write_file used', () => {
    const fixes = deriveQuickFixes({ toolCalls: [{ name: 'write_file' }], text: '' });
    assert.ok(fixes.some((f) => f.label.toLowerCase().includes('commit')));
  });
  test('suggests session after git_add_commit', () => {
    const fixes = deriveQuickFixes({ toolCalls: [{ name: 'git_add_commit' }], text: '' });
    assert.ok(fixes.some((f) => f.label.toLowerCase().includes('session')));
  });
  test('returns empty array when no tool calls', () => {
    assert.equal(deriveQuickFixes({ toolCalls: [], text: 'plain' }).length, 0);
  });
  test('each fix has label and cmd strings', () => {
    for (const fix of deriveQuickFixes({ toolCalls: [{ name: 'execute_command' }], text: '' })) {
      assert.ok(typeof fix.label === 'string');
      assert.ok(typeof fix.cmd === 'string');
    }
  });
});

describe('renderQuickFixBar', () => {
  test('returns empty string for empty fixes', () => {
    assert.equal(renderQuickFixBar([]), '');
  });
  test('returns non-empty string when fixes provided', () => {
    assert.ok(renderQuickFixBar([{ label: 'Run tests', cmd: 'npm test' }]).length > 0);
  });
  test('contains label text in output', () => {
    assert.ok(stripAnsi(renderQuickFixBar([{ label: 'Run tests', cmd: 'npm test' }])).includes('Run tests'));
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `node --test tests/quick-fix.test.js`
Expected: `ERR_MODULE_NOT_FOUND`

- [x] **Step 3: Implement `src/ui/quick-fix.js`**

```js
/**
 * Quick-Fix Suggestion Bar
 * Shown as a compact dim line after each agent turn.
 * Output: "💡 Next: [1] Run tests  [2] Git commit  [3] Show session"
 */
import { ansi } from '../utils/ansi.js';

const RULES = [
  {
    tools: ['write_file', 'patch_file'],
    suggestions: [
      { label: 'Run tests', cmd: 'run the tests and show results' },
      { label: 'Git commit', cmd: 'commit these changes with a meaningful message' },
      { label: 'Show session', cmd: '/session' },
    ],
  },
  {
    tools: ['execute_command'],
    suggestions: [
      { label: 'Check output', cmd: 'summarize the command output briefly' },
      { label: 'Show session', cmd: '/session' },
    ],
  },
  {
    tools: ['git_add_commit'],
    suggestions: [
      { label: 'Git log', cmd: 'show git log --oneline -5' },
      { label: 'Show session', cmd: '/session' },
    ],
  },
  {
    tools: ['web_fetch', 'web_search'],
    suggestions: [{ label: 'Summarize', cmd: 'summarize the fetched content briefly' }],
  },
];

export function deriveQuickFixes({ toolCalls = [], text = '' }) {
  if (!toolCalls || toolCalls.length === 0) return [];
  const usedTools = new Set(toolCalls.map((tc) => tc.name));
  const seen = new Set();
  const suggestions = [];
  for (const rule of RULES) {
    if (rule.tools.some((t) => usedTools.has(t))) {
      for (const s of rule.suggestions) {
        if (!seen.has(s.label)) { seen.add(s.label); suggestions.push(s); }
      }
    }
  }
  return suggestions.slice(0, 4);
}

export function renderQuickFixBar(fixes) {
  if (!fixes || fixes.length === 0) return '';
  const items = fixes
    .map((fix, i) => `${ansi.bold(ansi.cyan(`[${i + 1}]`))} ${ansi.white(fix.label)}`)
    .join('  ');
  return `${ansi.dim('\uD83D\uDCA1 Next:')} ${items}\n`;
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `node --test tests/quick-fix.test.js`
Expected: all tests PASS

- [x] **Step 5: Wire quick-fix bar into `src/cli/repl.js`**

Add import:
```js
import { deriveQuickFixes, renderQuickFixBar } from '../ui/quick-fix.js';
```

After the `output.write('\n\n');` that follows the markdown render, add:
```js
const fixes = deriveQuickFixes({ toolCalls: result.toolCalls, text: result.text });
const fixBar = renderQuickFixBar(fixes);
if (fixBar) output.write(fixBar);
```

- [x] **Step 6: Run full test suite**

Run: `node --test tests/*.test.js`
Expected: all tests PASS

- [x] **Step 7: Commit**

```bash
git add src/ui/quick-fix.js tests/quick-fix.test.js src/cli/repl.js
git commit -m "feat(ui): add quick-fix suggestion bar after each agent turn"
```

---

## Task 5: Polished Multi-Turn Prompt with History Indicator (#7)

**Files:**
- Create: `src/ui/history-indicator.js`
- Create: `tests/history-indicator.test.js`
- Modify: `src/cli/repl.js`

- [x] **Step 1: Write failing tests**

```js
// tests/history-indicator.test.js
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildPrompt, formatTurnBadge } from '../src/ui/history-indicator.js';
import { stripAnsi } from '../src/utils/ansi.js';

describe('formatTurnBadge', () => {
  test('returns empty string when turn is 0', () => {
    assert.equal(stripAnsi(formatTurnBadge(0)), '');
  });
  test('returns badge containing turn number when turn > 0', () => {
    assert.ok(stripAnsi(formatTurnBadge(3)).includes('3'));
  });
  test('always returns a string', () => {
    assert.equal(typeof formatTurnBadge(0), 'string');
    assert.equal(typeof formatTurnBadge(5), 'string');
  });
});

describe('buildPrompt', () => {
  test('contains appName in output', () => {
    assert.ok(stripAnsi(buildPrompt({ appName: 'fay', turn: 0 })).includes('fay'));
  });
  test('includes turn number when turn > 0', () => {
    assert.ok(stripAnsi(buildPrompt({ appName: 'fay', turn: 2 })).includes('2'));
  });
  test('no bracket indicator when turn is 0', () => {
    assert.ok(!stripAnsi(buildPrompt({ appName: 'fay', turn: 0 })).match(/\[\d+\]/));
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `node --test tests/history-indicator.test.js`
Expected: `ERR_MODULE_NOT_FOUND`

- [x] **Step 3: Implement `src/ui/history-indicator.js`**

```js
/**
 * REPL Prompt History Indicator
 * Format (turn 0):  fay ❯
 * Format (turn 3):  fay [3] ❯
 */
import { ansi } from '../utils/ansi.js';

export function formatTurnBadge(turn) {
  if (!turn || turn <= 0) return '';
  return ansi.dim(ansi.yellow(`[${turn}]`));
}

export function buildPrompt({ appName, turn = 0 }) {
  const badge = formatTurnBadge(turn);
  const nameStr = ansi.cyan(appName);
  const arrow = ansi.bold('\u276F');
  return badge ? `${nameStr} ${badge} ${arrow} ` : `${nameStr} ${arrow} `;
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `node --test tests/history-indicator.test.js`
Expected: all tests PASS

- [x] **Step 5: Wire dynamic prompt into `src/cli/repl.js`**

Add import:
```js
import { buildPrompt } from '../ui/history-indicator.js';
```

After `let lastIterations = 0;` add:
```js
let turnCount = 0;
```

Replace `prompt: REPL_PROMPT` in the `promptLine` call with:
```js
prompt: buildPrompt({ appName: APP_NAME, turn: turnCount }),
```

After `printStatusLine();` add:
```js
turnCount++;
```

- [x] **Step 6: Run full test suite**

Run: `node --test tests/*.test.js`
Expected: all tests PASS

- [x] **Step 7: Commit**

```bash
git add src/ui/history-indicator.js tests/history-indicator.test.js src/cli/repl.js
git commit -m "feat(ui): add dynamic turn-count badge to REPL prompt"
```

---

## Task 6: Improved Context Window Usage Bar (#12)

**Files:**
- Modify: `src/ui/box.js` (`renderStatusLine` function, lines 175-193)
- Modify: `tests/status-line.test.js` (relax exact-string assertions)

- [x] **Step 1: Update test assertions in `tests/status-line.test.js`**

Replace the four `assert.equal(stripAnsi(line), '...')` assertions with `assert.ok` presence checks:

```js
// For the "shows real usage" test:
const plain = stripAnsi(line);
assert.ok(plain.includes('5.2k tok'), `missing tok: ${plain}`);
assert.ok(plain.includes('12%'), `missing pct: ${plain}`);
assert.ok(plain.includes('loop 7/30'), `missing loop: ${plain}`);

// For the "tilde prefix" test:
const plain2 = stripAnsi(line);
assert.ok(plain2.includes('~0 tok'), `missing tok: ${plain2}`);
assert.ok(plain2.includes('0%'), `missing pct: ${plain2}`);
assert.ok(plain2.includes('loop 1/30'), `missing loop: ${plain2}`);

// For the "zero-token" test:
const plain3 = stripAnsi(line);
assert.ok(plain3.includes('0 tok'), `missing tok: ${plain3}`);

// For the "loop segment omitted" test:
const plain4 = stripAnsi(renderStatusLine({ usage: createUsage(), contextTokens: 0, contextBudget: 680000, iterations: 0, maxIterations: 30 }));
assert.ok(!plain4.includes('loop'), `loop should be absent: ${plain4}`);
assert.ok(!stripAnsi(renderStatusLine()).includes('loop'));

// For the "large values" test:
const plain5 = stripAnsi(line);
assert.ok(plain5.includes('1.2M tok'), `missing tok: ${plain5}`);
assert.ok(plain5.includes('104%'), `missing pct: ${plain5}`);
assert.ok(plain5.includes('loop 12/30'), `missing loop: ${plain5}`);
```

The dimmed color test (checking `\x1b[2m`) remains unchanged.

- [x] **Step 2: Run status-line tests to confirm they fail**

Run: `node --test tests/status-line.test.js`
Expected: FAIL (assertions changed but implementation not yet updated)

- [x] **Step 3: Modify `renderStatusLine` in `src/ui/box.js`**

Replace the full `renderStatusLine` function body:

```js
export function renderStatusLine(options = {}) {
  const usage = options.usage || {};
  const contextTokens = options.contextTokens || 0;
  const contextBudget = options.contextBudget || 0;
  const iterations = options.iterations || 0;
  const maxIterations = options.maxIterations || 0;

  const estimated = !usage.llmRequests;
  const tok = `${estimated ? '~' : ''}${formatCompactTokens(usage.totalTokens || 0)} tok`;
  const pct = contextBudget > 0 ? Math.floor((contextTokens / contextBudget) * 100) : 0;

  // 10-char visual progress bar
  const BAR_WIDTH = 10;
  const filled = Math.min(BAR_WIDTH, Math.round((pct / 100) * BAR_WIDTH));
  const bar = '\u2593'.repeat(filled) + '\u2591'.repeat(BAR_WIDTH - filled);
  // Color: green <60%, yellow 60-84%, red >=85%
  const coloredBar = pct >= 85 ? ansi.red(bar) : pct >= 60 ? ansi.yellow(bar) : ansi.green(bar);

  const ctxSegment = `${coloredBar} ${pct}%`;
  const segments = [tok, ctxSegment];
  if (iterations > 0 && maxIterations > 0) {
    segments.push(`loop ${iterations}/${Number.isFinite(maxIterations) ? maxIterations : '\u221E'}`);
  }

  return ansi.dim(`\u2500 ${segments.join(' \u2502 ')} \u2500`);
}
```

- [x] **Step 4: Run status-line tests**

Run: `node --test tests/status-line.test.js`
Expected: all tests PASS

- [x] **Step 5: Run full test suite**

Run: `node --test tests/*.test.js`
Expected: all tests PASS

- [x] **Step 6: Commit**

```bash
git add src/ui/box.js tests/status-line.test.js
git commit -m "feat(ui): improve context window bar with visual progress and color thresholds"
```

---

## Final Integration Check

- [x] **Step 1: Run all tests**

Run: `node --test tests/*.test.js`
Expected: all tests PASS

- [x] **Step 2: Verify branch**

```bash
git status
git log --oneline feat/ux-interaction ^main
```

Expected: 6 commits, working tree clean

---

## Self-Review

### Spec Coverage

| Feature | Task | Covered? |
|---------|------|----------|
| #7 Polished multi-turn prompt | Task 5 | ✅ |
| #8 Thought display toggle | Task 1 | ✅ |
| #9 Inline diff preview | Task 3 | ✅ |
| #10 Keyboard shortcut overlay | Task 2 | ✅ |
| #11 Quick-fix suggestions | Task 4 | ✅ |
| #12 Improved context bar | Task 6 | ✅ |

### Placeholder Scan

No TBD, TODO, or "fill in" patterns. Every step has concrete code or an exact command.

### Type Consistency

- `createThoughtDisplay()` → `{ isEnabled(), toggle(), processToken(token) }` — consistent across Tasks 1, repl.js, single-shot.js
- `deriveQuickFixes({ toolCalls, text })` → `Array<{ label, cmd }>` — fed directly to `renderQuickFixBar(fixes)`
- `buildPrompt({ appName, turn })` → `string` — replaces `REPL_PROMPT` in `promptLine({ prompt: ... })`
- `renderDiffPreview({ filePath, before, after })` → `string` — written to stream in guard.js
- `buildShortcutOverlay()` → `string` — written to `output` in REPL loop
- `renderStatusLine()` — signature unchanged; only rendering differs (bar replaces `ctx N%` text)
