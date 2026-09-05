# Core Agent & Tooling (features.md Kategori 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the 6 "Must Have" features of features.md Kategori 1 — `grep_file`, `search_files`, git tools (`git_status`/`git_diff`/`git_add_commit`), `web_fetch`, `web_search`, and project-root auto-detection.

**Architecture:** Each tool is a plain async function `(args, context) => result` following the existing `src/tools/` pattern: own file, registered in `TOOLS_MAP` + `TOOL_DECLARATIONS` + `TOOL_ARG_ALIASES` (`src/tools/registry.js`), re-exported from `src/tools/index.js`, path-authorized by a case in `SecurityGuard.authorize` (`src/security/guard.js`). Git tools spawn the `git` binary with an argv array (never a shell string) so arguments cannot inject metacharacters. Web tools use Node's built-in `fetch` (engines: node >= 20) and accept `context.fetch` so tests run without network. Project detection is a sync util that walks up from a start dir looking for markers (`.git`, `package.json`, …), wired into the orchestrator's default `workingDir` and the system prompt environment block.

**Tech Stack:** Node.js >= 20 (ESM), `node:fs`, `node:fs/promises`, `node:child_process.spawn`, built-in `fetch`/`AbortSignal.timeout`, `node:test` + `assert/strict`, Biome lint. **Zero new npm dependencies.**

**Conventions this plan follows (read before starting):**
- Tool signature: `export async function xTool(args, context = {})`. `context.baseDir` is the workspace root; resolve every path with `path.resolve(context.baseDir || process.cwd(), userPath)`.
- Throw `Error` for invalid args — `dispatchToolCall` converts throws to `{ error: true, message }` for the LLM.
- Gemini schema types are UPPERCASE (`STRING`, `INTEGER`, `BOOLEAN`, `ARRAY` + `items`).
- Tests: `node --test tests/<file>.test.js`, temp dirs via `fs.mkdtempSync(path.join(os.tmpdir(), 'faycli-…'))`, cleanup in `afterEach`.
- Commits: Conventional Commits (commitlint is configured).
- Full test suite: `npm test`. Lint: `npm run lint`.

**Existing files you will modify (know these anchors):**
- `src/tools/registry.js` — `TOOLS_MAP` (line ~14), `TOOL_DECLARATIONS` (line ~25), `TOOL_ARG_ALIASES` (line ~174).
- `src/tools/index.js` — barrel exports.
- `src/security/guard.js` — `authorize()` switch (line ~172).
- `src/llm/openai.js` — `TEXT_TOOL_NAMES` (line 462).
- `src/agent/system-prompt.js` — tool list in `DEFAULT_AGENT_INSTRUCTIONS` (line 83), env block in `buildSystemPrompt` (line ~110).
- `src/agent/orchestrator.js` — `this.workingDir = options.workingDir || process.cwd();` (line 49).

**Gotcha:** `tests/registry-args.test.js:64` asserts every key of `TOOLS_MAP` has an array in `TOOL_ARG_ALIASES`. Registering a tool without alias rules fails that suite. Each task below registers tool + aliases together.

---

## File Structure

```
src/utils/glob.js        (create)  escapeRegExp + globToRegExp
src/utils/fs-walk.js     (create)  walkFiles async generator (shared by grep/search)
src/utils/html.js        (create)  stripHtml + decodeEntities (shared by web tools)
src/utils/project.js     (create)  PROJECT_MARKERS + findProjectRoot (sync)
src/tools/grep_file.js   (create)  grepFileTool
src/tools/search_files.js(create)  searchFilesTool
src/tools/git.js         (create)  gitStatusTool, gitDiffTool, gitAddCommitTool + runGit
src/tools/web_fetch.js   (create)  webFetchTool
src/tools/web_search.js  (create)  webSearchTool
tests/cat1-utils.test.js (create)  glob + walkFiles
tests/cat1-grep.test.js  (create)  grep_file
tests/cat1-search.test.js(create)  search_files
tests/cat1-git.test.js   (create)  git tools
tests/cat1-web.test.js   (create)  web_fetch + web_search (stubbed fetch)
tests/cat1-project.test.js(create) findProjectRoot + system prompt block
tests/cat1-wiring.test.js(create)  registry/guard/TEXT_TOOL_NAMES wiring
```

`git.js` holds all three git tools on purpose: they share `runGit` and change together. `html.js` is shared by `web_fetch` and `web_search`.

---

### Task 1: Shared utils — glob + fs-walk

**Files:**
- Create: `src/utils/glob.js`
- Create: `src/utils/fs-walk.js`
- Test: `tests/cat1-utils.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/cat1-utils.test.js`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { walkFiles } from '../src/utils/fs-walk.js';
import { escapeRegExp, globToRegExp } from '../src/utils/glob.js';

describe('globToRegExp', () => {
  test('escapeRegExp escapes metacharacters', () => {
    assert.equal(escapeRegExp('a.b+c'), 'a\\.b\\+c');
  });

  test('* stays inside one path segment', () => {
    const re = globToRegExp('src/*.js');
    assert.ok(re.test('src/app.js'));
    assert.ok(!re.test('src/deep/app.js'));
    assert.ok(!re.test('src/app.ts'));
  });

  test('** crosses path segments', () => {
    const re = globToRegExp('**/*.test.js');
    assert.ok(re.test('tests/a.test.js'));
    assert.ok(re.test('a.test.js'));
    assert.ok(re.test('x/y/z/a.test.js'));
  });

  test('? matches exactly one non-separator char', () => {
    const re = globToRegExp('a?.js');
    assert.ok(re.test('ab.js'));
    assert.ok(!re.test('abc.js'));
    assert.ok(!re.test('a.js'));
  });

  test('literal dots are not wildcards', () => {
    assert.ok(!globToRegExp('a.js').test('axjs'));
  });

  test('matches forward-slash paths only (callers normalize separators)', () => {
    assert.ok(globToRegExp('src/*.js').test('src/app.js'));
    assert.ok(!globToRegExp('src/*.js').test('src\\app.js'));
  });
});

describe('walkFiles', () => {
  let dir;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'faycli-walk-test-'));
    fs.mkdirSync(path.join(dir, 'node_modules', 'pkg'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'root.txt'), 'x');
    fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'x');
    fs.writeFileSync(path.join(dir, 'node_modules', 'pkg', 'b.js'), 'x');
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('yields files recursively, skipping ignored dirs', async () => {
    const found = [];
    for await (const entry of walkFiles(dir, { ignores: new Set(['node_modules']) })) {
      found.push(entry.relativePath.split(path.sep).join('/'));
    }
    assert.deepEqual(found.sort(), ['root.txt', 'src/a.js']);
  });

  test('maxEntries bounds the walk', async () => {
    let count = 0;
    for await (const entry of walkFiles(dir, { ignores: new Set(['node_modules']), maxEntries: 1 })) {
      assert.ok(entry.fullPath);
      count++;
    }
    assert.equal(count, 1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/cat1-utils.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `../src/utils/glob.js`.

- [ ] **Step 3: Implement `src/utils/glob.js`**

```js
/**
 * Glob pattern → RegExp for tool file matching (`*`, `**`, `?`).
 * No brace expansion, no character classes — models emit simple patterns.
 */

/** Escapes regex metacharacters in a literal string. */
export function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compiles a glob into an anchored RegExp.
 * Matching is done against forward-slash relative paths.
 *
 * @param {string} pattern - glob pattern supporting `*`, `**` and `?`
 * @returns {RegExp}
 */
export function globToRegExp(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*';
        i++;
        // consume a trailing "/" so "**/*.js" also matches root-level "a.js"
        if (pattern[i + 1] === '/') i++;
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else {
      out += escapeRegExp(c);
    }
  }
  return new RegExp(`^${out}$`);
}
```

- [ ] **Step 4: Implement `src/utils/fs-walk.js`**

```js
/**
 * Async directory walker shared by grep_file and search_files.
 * Iterative (explicit stack, no recursion limit), skips ignored names,
 * bounded by maxEntries so huge trees cannot hang the agent.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * Yields regular files under rootDir.
 *
 * @param {string} rootDir - absolute path
 * @param {object} [options]
 * @param {Set<string>} [options.ignores] - directory/file NAMES to skip
 * @param {number} [options.maxEntries=5000]
 * @yields {{ fullPath: string, relativePath: string }}
 */
export async function* walkFiles(rootDir, { ignores = new Set(), maxEntries = 5000 } = {}) {
  const stack = [rootDir];
  let count = 0;
  while (stack.length > 0) {
    const dir = stack.pop();
    let items;
    try {
      items = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue; // permission denied / race with deletion — skip subtree
    }
    for (const item of items) {
      if (ignores.has(item.name)) continue;
      const full = path.join(dir, item.name);
      if (item.isDirectory()) {
        stack.push(full);
      } else if (item.isFile()) {
        if (++count > maxEntries) return;
        yield { fullPath: full, relativePath: path.relative(rootDir, full) };
      }
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/cat1-utils.test.js`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add src/utils/glob.js src/utils/fs-walk.js tests/cat1-utils.test.js
git commit -m "feat(tools): add glob and fs-walk shared utils for search tools"
```

---

### Task 2: `grep_file` tool

**Files:**
- Create: `src/tools/grep_file.js`
- Modify: `src/tools/registry.js` (TOOLS_MAP, TOOL_DECLARATIONS, TOOL_ARG_ALIASES)
- Modify: `src/tools/index.js`
- Modify: `src/security/guard.js` (authorize case)
- Test: `tests/cat1-grep.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/cat1-grep.test.js`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { SecurityGuard } from '../src/security/guard.js';
import { dispatchToolCall } from '../src/tools/registry.js';
import { grepFileTool } from '../src/tools/grep_file.js';

describe('grep_file tool', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'faycli-grep-test-'));
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello world\nHELLO again\nbye');
    fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'sub', 'b.js'), 'const foo = 1;\n// hello there');
    fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', 'skip.txt'), 'hello');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('case-insensitive substring match across files', async () => {
    // a.txt lines 1-2 + sub/b.js line 2; node_modules/skip.txt is ignored
    const res = await grepFileTool({ pattern: 'hello' }, { baseDir: dir });
    assert.equal(res.matches.length, 3);
  });

  test('regex pattern works', async () => {
    const res = await grepFileTool({ pattern: 'w.ld' }, { baseDir: dir });
    assert.equal(res.matches.length, 1);
    assert.equal(res.matches[0].file.split(path.sep).join('/'), 'a.txt');
    assert.equal(res.matches[0].line, 1);
    assert.equal(res.matches[0].content, 'hello world');
  });

  test('caseSensitive=true narrows results', async () => {
    const res = await grepFileTool({ pattern: 'HELLO', caseSensitive: true }, { baseDir: dir });
    assert.equal(res.matches.length, 1);
  });

  test('glob filters files', async () => {
    const res = await grepFileTool({ pattern: 'hello', glob: '*.js' }, { baseDir: dir });
    assert.equal(res.matches.length, 1);
    assert.ok(res.matches[0].file.endsWith('b.js'));
  });

  test('maxResults truncates', async () => {
    const res = await grepFileTool({ pattern: 'hello', maxResults: 2 }, { baseDir: dir });
    assert.equal(res.matches.length, 2);
    assert.equal(res.truncated, true);
  });

  test('invalid regex throws readable error', async () => {
    await assert.rejects(() => grepFileTool({ pattern: '([' }, { baseDir: dir }), /Invalid regex/);
  });

  test('missing pattern throws', async () => {
    await assert.rejects(() => grepFileTool({}, { baseDir: dir }), /pattern/);
  });

  test('registered and dispatchable via registry', async () => {
    const out = await dispatchToolCall('grep_file', { query: 'bye' }, { baseDir: dir });
    assert.equal(out.success, true);
    assert.equal(out.result.matches.length, 1);
  });

  test('security guard prompts for dirPath outside workspace', async () => {
    let prompted = false;
    const guard = new SecurityGuard({
      baseDir: dir,
      confirmationHandler: async () => {
        prompted = true;
        return false;
      },
    });
    const out = await dispatchToolCall(
      'grep_file',
      { pattern: 'x', dirPath: '..' },
      { baseDir: dir, securityGuard: guard },
    );
    assert.equal(out.error, true);
    assert.ok(prompted);
  });
});
```

Note on the first test: `hello` matches `a.txt` lines 1–2 and `sub/b.js` line 2 = 3 matches; `node_modules/skip.txt` is ignored by `DEFAULT_IGNORE_PATTERNS`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/cat1-grep.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `../src/tools/grep_file.js`.

- [ ] **Step 3: Implement `src/tools/grep_file.js`**

```js
/**
 * Tool: grep_file
 * Recursive regex text search across the workspace, with glob filtering,
 * ignore-list protection, and result caps to bound token usage.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { isBinaryFile } from '../security/path-validator.js';
import { DEFAULT_IGNORE_PATTERNS, DEFAULT_SECURITY_CONFIG } from '../security/rules.js';
import { walkFiles } from '../utils/fs-walk.js';
import { globToRegExp } from '../utils/glob.js';

const MAX_LINE_PREVIEW = 500;

/**
 * @param {object} args
 * @param {string} args.pattern - JavaScript regex source
 * @param {string} [args.dirPath='.'] - Search root (relative to context.baseDir)
 * @param {string} [args.glob] - File filter glob, e.g. "src/*.js"
 * @param {boolean} [args.caseSensitive=false]
 * @param {number} [args.maxResults=100]
 * @param {object} [context={}]
 * @returns {Promise<object>}
 */
export async function grepFileTool(args = {}, context = {}) {
  const { pattern, dirPath = '.', glob, caseSensitive = false, maxResults = 100 } = args;

  if (!pattern || typeof pattern !== 'string') {
    throw new Error('Missing or invalid "pattern" argument (regex source string)');
  }

  let regex;
  try {
    regex = new RegExp(pattern, caseSensitive ? 'g' : 'gi');
  } catch (err) {
    throw new Error(`Invalid regex pattern "${pattern}": ${err.message}`);
  }

  const globRe = glob ? globToRegExp(String(glob)) : null;
  const resolvedBase = path.resolve(context.baseDir || process.cwd(), dirPath);
  const limit = Math.max(1, Math.min(Number(maxResults) || 100, 1000));
  const maxFileBytes = context.maxReadSizeBytes || DEFAULT_SECURITY_CONFIG.maxReadSizeBytes;

  const matches = [];
  let filesScanned = 0;
  let truncated = false;

  for await (const { fullPath, relativePath } of walkFiles(resolvedBase, {
    ignores: new Set(DEFAULT_IGNORE_PATTERNS),
  })) {
    const posixRel = relativePath.split(path.sep).join('/');
    if (globRe && !globRe.test(posixRel)) continue;

    let stat;
    try {
      stat = await fsp.stat(fullPath);
    } catch {
      continue;
    }
    if (stat.size > maxFileBytes) continue;
    if (isBinaryFile(fullPath)) continue;

    let text;
    try {
      text = await fsp.readFile(fullPath, 'utf-8');
    } catch {
      continue;
    }

    filesScanned++;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      regex.lastIndex = 0;
      if (!regex.test(lines[i])) continue;
      matches.push({
        file: posixRel,
        line: i + 1,
        content: lines[i].slice(0, MAX_LINE_PREVIEW),
      });
      if (matches.length >= limit) {
        truncated = true;
        break;
      }
    }
    if (truncated) break;
  }

  return { pattern, matches, totalMatches: matches.length, filesScanned, truncated };
}
```

- [ ] **Step 4: Register in `src/tools/registry.js`**

Add import at top (with the other tool imports):

```js
import { grepFileTool } from './grep_file.js';
```

Add to `TOOLS_MAP`:

```js
  grep_file: grepFileTool,
```

Add to `TOOL_DECLARATIONS` (append after the `execute_command` entry):

```js
  {
    name: 'grep_file',
    description:
      'Search file contents with a JavaScript regex across the workspace. Skips .git, node_modules and binary files. Returns file, line number and line text per match.',
    parameters: {
      type: 'OBJECT',
      properties: {
        pattern: { type: 'STRING', description: 'JavaScript regex source, e.g. "function\\s+\\w+"' },
        dirPath: { type: 'STRING', description: 'Directory to search (default "." = workspace root)' },
        glob: { type: 'STRING', description: 'Optional file filter glob, e.g. "src/**/*.js"' },
        caseSensitive: { type: 'BOOLEAN', description: 'Case-sensitive matching (default false)' },
        maxResults: { type: 'INTEGER', description: 'Maximum matches to return (default 100, max 1000)' },
      },
      required: ['pattern'],
    },
  },
```

Add to `TOOL_ARG_ALIASES`:

```js
  grep_file: [
    { target: 'pattern', aliases: ['query', 'regex', 'search', 'searchString', 'text'] },
    { target: 'dirPath', aliases: ['path', 'dir', 'directory', 'folder'], fallback: '.' },
  ],
```

- [ ] **Step 5: Export from `src/tools/index.js`**

```js
export * from './grep_file.js';
```

(keep alphabetical order in the file: after `execute_command.js`.)

- [ ] **Step 6: Add guard case in `src/security/guard.js`**

In the `authorize()` switch, extend the `list_dir` case to also cover `grep_file` and `search_files` (same dirPath semantics). Replace `case 'list_dir': {` with:

```js
      case 'list_dir':
      case 'grep_file':
      case 'search_files': {
```

The body already reads `args.dirPath || '.'` and prompts when outside workspace — no other change needed.

- [ ] **Step 7: Run tests**

Run: `node --test tests/cat1-grep.test.js`
Expected: PASS (9 tests).
Run: `npm test`
Expected: all suites pass (registry-args alias-coverage test now sees `grep_file`).

- [ ] **Step 8: Commit**

```bash
git add src/tools/grep_file.js src/tools/registry.js src/tools/index.js src/security/guard.js tests/cat1-grep.test.js
git commit -m "feat(tools): add grep_file tool with regex workspace search"
```

---

### Task 3: `search_files` tool

**Files:**
- Create: `src/tools/search_files.js`
- Modify: `src/tools/registry.js`, `src/tools/index.js`
- Test: `tests/cat1-search.test.js`

Guard case already added in Task 2 Step 6 (`case 'search_files'` shares `list_dir`) — verify it is present, do not re-add.

- [ ] **Step 1: Write the failing test**

Create `tests/cat1-search.test.js`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { dispatchToolCall } from '../src/tools/registry.js';
import { searchFilesTool } from '../src/tools/search_files.js';

describe('search_files tool', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'faycli-search-test-'));
    fs.mkdirSync(path.join(dir, 'src', 'deep'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.js'), '');
    fs.writeFileSync(path.join(dir, 'src', 'app.js'), '');
    fs.writeFileSync(path.join(dir, 'src', 'deep', 'util.test.js'), '');
    fs.writeFileSync(path.join(dir, 'src', 'README.md'), '');
    fs.writeFileSync(path.join(dir, 'node_modules', 'evil.js'), '');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('**/*.js finds all js files outside node_modules', async () => {
    const res = await searchFilesTool({ pattern: '**/*.js' }, { baseDir: dir });
    const files = res.files.map((f) => f.path).sort();
    assert.deepEqual(files, ['index.js', 'src/app.js', 'src/deep/util.test.js']);
  });

  test('single-segment glob matches basename anywhere', async () => {
    const res = await searchFilesTool({ pattern: '*.test.js' }, { baseDir: dir });
    assert.equal(res.files.length, 1);
    assert.ok(res.files[0].path.endsWith('util.test.js'));
  });

  test('maxResults truncates', async () => {
    const res = await searchFilesTool({ pattern: '**/*.js', maxResults: 2 }, { baseDir: dir });
    assert.equal(res.files.length, 2);
    assert.equal(res.truncated, true);
  });

  test('missing pattern throws', async () => {
    await assert.rejects(() => searchFilesTool({}, { baseDir: dir }), /pattern/);
  });

  test('dispatchable via registry with alias', async () => {
    const out = await dispatchToolCall('search_files', { glob: '**/*.md' }, { baseDir: dir });
    assert.equal(out.success, true);
    assert.equal(out.result.files.length, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/cat1-search.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `../src/tools/search_files.js`.

- [ ] **Step 3: Implement `src/tools/search_files.js`**

```js
/**
 * Tool: search_files
 * Find files by glob pattern. A pattern without "/" matches basenames at any
 * depth (like `find -name`); patterns with "/" match relative paths.
 */

import path from 'node:path';
import { DEFAULT_IGNORE_PATTERNS } from '../security/rules.js';
import { walkFiles } from '../utils/fs-walk.js';
import { globToRegExp } from '../utils/glob.js';

/**
 * @param {object} args
 * @param {string} args.pattern - glob, e.g. "*.js" or "src/*.js"
 * @param {string} [args.dirPath='.'] - Search root
 * @param {number} [args.maxResults=200]
 * @param {object} [context={}]
 * @returns {Promise<object>}
 */
export async function searchFilesTool(args = {}, context = {}) {
  const { pattern, dirPath = '.', maxResults = 200 } = args;

  if (!pattern || typeof pattern !== 'string') {
    throw new Error('Missing or invalid "pattern" argument (glob string)');
  }

  const normalized = pattern.split(path.sep).join('/');
  const anchored = normalized.includes('/') ? normalized : `**/${normalized}`;
  const regex = globToRegExp(anchored);
  const resolvedBase = path.resolve(context.baseDir || process.cwd(), dirPath);
  const limit = Math.max(1, Math.min(Number(maxResults) || 200, 2000));

  const files = [];
  let truncated = false;

  for await (const { relativePath } of walkFiles(resolvedBase, {
    ignores: new Set(DEFAULT_IGNORE_PATTERNS),
  })) {
    const posixRel = relativePath.split(path.sep).join('/');
    if (!regex.test(posixRel)) continue;
    files.push({ path: posixRel });
    if (files.length >= limit) {
      truncated = true;
      break;
    }
  }

  return { pattern, dirPath, files, total: files.length, truncated };
}
```

- [ ] **Step 4: Register in `src/tools/registry.js`**

Import: `import { searchFilesTool } from './search_files.js';`
`TOOLS_MAP`: `search_files: searchFilesTool,`
`TOOL_DECLARATIONS` entry:

```js
  {
    name: 'search_files',
    description:
      'Find files by glob pattern. Patterns without "/" match file names at any depth (e.g. "*.test.js"); patterns with "/" match relative paths (e.g. "src/**/*.js"). Skips .git and node_modules.',
    parameters: {
      type: 'OBJECT',
      properties: {
        pattern: { type: 'STRING', description: 'Glob pattern to match file names or paths' },
        dirPath: { type: 'STRING', description: 'Search root directory (default ".")' },
        maxResults: { type: 'INTEGER', description: 'Maximum files to return (default 200)' },
      },
      required: ['pattern'],
    },
  },
```

`TOOL_ARG_ALIASES`:

```js
  search_files: [
    { target: 'pattern', aliases: ['query', 'glob', 'name', 'filename', 'find'] },
    { target: 'dirPath', aliases: ['path', 'dir', 'directory', 'folder'], fallback: '.' },
  ],
```

- [ ] **Step 5: Export from `src/tools/index.js`**

```js
export * from './search_files.js';
```

- [ ] **Step 6: Run tests**

Run: `node --test tests/cat1-search.test.js && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/tools/search_files.js src/tools/registry.js src/tools/index.js tests/cat1-search.test.js
git commit -m "feat(tools): add search_files glob tool"
```

---

### Task 4: Git tools (`git_status`, `git_diff`, `git_add_commit`)

**Files:**
- Create: `src/tools/git.js`
- Modify: `src/tools/registry.js`, `src/tools/index.js`, `src/security/guard.js`
- Test: `tests/cat1-git.test.js`

Design notes:
- `runGit` spawns `git` with an **argv array, no shell** — user-supplied file paths can never inject shell syntax.
- `git_add_commit` is mutating: guard always prompts unless `autoApprove`.
- `git status --porcelain=v1 -b` output: line 1 `## main...origin/main`, then `XY path` lines.

- [ ] **Step 1: Write the failing test**

Create `tests/cat1-git.test.js`:

```js
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { SecurityGuard } from '../src/security/guard.js';
import { dispatchToolCall } from '../src/tools/registry.js';
import { gitAddCommitTool, gitDiffTool, gitStatusTool } from '../src/tools/git.js';

describe('git tools', () => {
  let dir;
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'faycli-git-test-'));
    git('init', '-b', 'main');
    git('config', 'user.email', 'test@faycli.local');
    git('config', 'user.name', 'faycli-test');
    fs.writeFileSync(path.join(dir, 'tracked.txt'), 'line1\n');
    git('add', '.');
    git('commit', '-m', 'initial');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('git_status reports clean branch', async () => {
    const res = await gitStatusTool({}, { baseDir: dir });
    assert.equal(res.branch, 'main');
    assert.equal(res.isDirty, false);
    assert.deepEqual(res.changes, []);
  });

  test('git_status lists modified and untracked files', async () => {
    fs.appendFileSync(path.join(dir, 'tracked.txt'), 'line2\n');
    fs.writeFileSync(path.join(dir, 'new.txt'), 'x');
    const res = await gitStatusTool({}, { baseDir: dir });
    assert.equal(res.isDirty, true);
    const byPath = Object.fromEntries(res.changes.map((c) => [c.path, c.status]));
    assert.equal(byPath['tracked.txt'], 'M');
    assert.equal(byPath['new.txt'], '??');
  });

  test('git_diff shows working tree changes', async () => {
    fs.appendFileSync(path.join(dir, 'tracked.txt'), 'added\n');
    const res = await gitDiffTool({}, { baseDir: dir });
    assert.equal(res.hasChanges, true);
    assert.ok(res.diff.includes('+added'));
  });

  test('git_diff scoped to one file', async () => {
    fs.writeFileSync(path.join(dir, 'other.txt'), 'zzz');
    const res = await gitDiffTool({ file: 'other.txt' }, { baseDir: dir });
    // other.txt is untracked → diff of tracked changes only
    assert.equal(res.hasChanges, false);
  });

  test('git_add_commit commits staged changes', async () => {
    fs.writeFileSync(path.join(dir, 'feature.js'), 'export const x = 1;');
    const res = await gitAddCommitTool(
      { message: 'feat: add x', files: ['feature.js'] },
      { baseDir: dir },
    );
    assert.equal(res.committed, true);
    const status = await gitStatusTool({}, { baseDir: dir });
    assert.equal(status.isDirty, false);
  });

  test('git_add_commit without message throws', async () => {
    await assert.rejects(() => gitAddCommitTool({ files: ['.'] }, { baseDir: dir }), /message/);
  });

  test('git_add_commit with nothing to commit reports not committed', async () => {
    const res = await gitAddCommitTool({ message: 'empty' }, { baseDir: dir });
    assert.equal(res.committed, false);
  });

  test('git_add_commit requires confirmation via guard', async () => {
    let prompted = false;
    const guard = new SecurityGuard({
      baseDir: dir,
      confirmationHandler: async () => {
        prompted = true;
        return false;
      },
    });
    const out = await dispatchToolCall(
      'git_add_commit',
      { message: 'x' },
      { baseDir: dir, securityGuard: guard },
    );
    assert.equal(out.error, true);
    assert.ok(prompted);
  });

  test('git_status outside a git repo returns error message', async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'faycli-nogit-'));
    try {
      await assert.rejects(() => gitStatusTool({}, { baseDir: plain }), /not a git repository|git/i);
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/cat1-git.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `../src/tools/git.js`.

- [ ] **Step 3: Implement `src/tools/git.js`**

```js
/**
 * Tools: git_status, git_diff, git_add_commit
 * Spawn the git binary with an argv array (never a shell string) so file
 * paths cannot inject shell metacharacters.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';

const GIT_TIMEOUT_MS = 15000;

/**
 * Run git with argv args in cwd. Resolves { code, stdout, stderr }.
 * Rejects only when the git binary itself cannot spawn.
 */
function runGit(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`git ${args[0]} timed out after ${GIT_TIMEOUT_MS}ms`));
    }, GIT_TIMEOUT_MS);
    child.stdout.on('data', (c) => {
      stdout += c.toString('utf-8');
    });
    child.stderr.on('data', (c) => {
      stderr += c.toString('utf-8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`git is not available: ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function resolveCwd(args, context) {
  return path.resolve(context.baseDir || process.cwd(), args.workingDir || '.');
}

/** Ensures cwd is a git work tree; throws a model-readable error otherwise. */
async function assertGitRepo(cwd) {
  const check = await runGit(['rev-parse', '--is-inside-work-tree'], cwd);
  if (check.code !== 0) {
    throw new Error(`"${cwd}" is not a git repository: ${check.stderr.trim() || 'git rev-parse failed'}`);
  }
}

/**
 * @param {object} args
 * @param {string} [args.workingDir]
 * @param {object} [context]
 */
export async function gitStatusTool(args = {}, context = {}) {
  const cwd = resolveCwd(args, context);
  await assertGitRepo(cwd);
  const { code, stdout, stderr } = await runGit(['status', '--porcelain=v1', '-b'], cwd);
  if (code !== 0) {
    throw new Error(`git status failed: ${stderr.trim()}`);
  }

  const lines = stdout.split('\n').filter(Boolean);
  let branch = '(detached)';
  const changes = [];
  for (const line of lines) {
    if (line.startsWith('## ')) {
      // "## main...origin/main" or "## HEAD (no branch)"
      branch = line.slice(3).split('...')[0].trim();
      continue;
    }
    changes.push({ status: line.slice(0, 2).trim() || '??', path: line.slice(3) });
  }

  return { branch, isDirty: changes.length > 0, changes, raw: stdout };
}

/**
 * @param {object} args
 * @param {string} [args.file] - limit diff to one path
 * @param {boolean} [args.staged=false] - diff the index instead of work tree
 * @param {string} [args.workingDir]
 * @param {object} [context]
 */
export async function gitDiffTool(args = {}, context = {}) {
  const cwd = resolveCwd(args, context);
  await assertGitRepo(cwd);
  const gitArgs = ['diff'];
  if (args.staged) gitArgs.push('--cached');
  if (args.file) gitArgs.push('--', args.file);
  const { code, stdout, stderr } = await runGit(gitArgs, cwd);
  if (code !== 0) {
    throw new Error(`git diff failed: ${stderr.trim()}`);
  }
  return { diff: stdout, hasChanges: stdout.trim().length > 0 };
}

/**
 * @param {object} args
 * @param {string} args.message - commit message (required)
 * @param {string[]} [args.files=['.']] - paths to stage
 * @param {string} [args.workingDir]
 * @param {object} [context]
 */
export async function gitAddCommitTool(args = {}, context = {}) {
  const { message, files = ['.'] } = args;
  if (!message || typeof message !== 'string') {
    throw new Error('Missing or invalid "message" argument (commit message string)');
  }
  const fileList = (Array.isArray(files) ? files : [files]).map(String);
  const cwd = resolveCwd(args, context);
  await assertGitRepo(cwd);

  const add = await runGit(['add', '--', ...fileList], cwd);
  if (add.code !== 0) {
    throw new Error(`git add failed: ${add.stderr.trim()}`);
  }

  const commit = await runGit(['commit', '-m', message], cwd);
  const committed = commit.code === 0;
  return {
    committed,
    message: committed ? message : null,
    output: `${commit.stdout}${commit.stderr}`.trim(),
  };
}
```

- [ ] **Step 4: Register in `src/tools/registry.js`**

Import: `import { gitAddCommitTool, gitDiffTool, gitStatusTool } from './git.js';`
`TOOLS_MAP`:

```js
  git_status: gitStatusTool,
  git_diff: gitDiffTool,
  git_add_commit: gitAddCommitTool,
```

`TOOL_DECLARATIONS` entries:

```js
  {
    name: 'git_status',
    description: 'Show current git branch and working-tree changes (porcelain format).',
    parameters: {
      type: 'OBJECT',
      properties: {
        workingDir: { type: 'STRING', description: 'Repo directory (default workspace root)' },
      },
    },
  },
  {
    name: 'git_diff',
    description: 'Show unstaged (or staged) git diff, optionally limited to one file.',
    parameters: {
      type: 'OBJECT',
      properties: {
        file: { type: 'STRING', description: 'Only diff this path (optional)' },
        staged: { type: 'BOOLEAN', description: 'Diff the index instead of the working tree (default false)' },
        workingDir: { type: 'STRING', description: 'Repo directory (default workspace root)' },
      },
    },
  },
  {
    name: 'git_add_commit',
    description:
      'Stage the given paths and create a commit with a message. Requires user confirmation unless auto-approve is on.',
    parameters: {
      type: 'OBJECT',
      properties: {
        message: { type: 'STRING', description: 'Commit message' },
        files: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Paths to stage (default ["."])',
        },
        workingDir: { type: 'STRING', description: 'Repo directory (default workspace root)' },
      },
      required: ['message'],
    },
  },
```

`TOOL_ARG_ALIASES`:

```js
  git_status: [{ target: 'workingDir', aliases: ['path', 'dir', 'cwd'], fallback: '.' }],
  git_diff: [
    { target: 'file', aliases: ['filePath', 'path', 'target_file'] },
    { target: 'workingDir', aliases: ['dir', 'cwd'], fallback: '.' },
  ],
  git_add_commit: [
    { target: 'message', aliases: ['msg', 'commitMessage', 'commit_message'] },
    { target: 'files', aliases: ['paths', 'filePaths'] },
    { target: 'workingDir', aliases: ['path', 'dir', 'cwd'], fallback: '.' },
  ],
```

- [ ] **Step 5: Export from `src/tools/index.js`**

```js
export * from './git.js';
```

- [ ] **Step 6: Guard cases in `src/security/guard.js`**

Add before the `default:` branch of `authorize()`:

```js
      case 'git_status':
      case 'git_diff': {
        if (args.workingDir && args.workingDir !== '.') {
          const pathValidation = validateSafePath(args.workingDir, this.baseDir, this._pathOptions());
          if (!pathValidation.isAllowed && !this.autoApprove) {
            const confirmed = await this.promptConfirmation(
              `AI wants to run git ${toolName === 'git_status' ? 'status' : 'diff'} outside workspace: "${pathValidation.resolvedPath}"`,
            );
            if (!confirmed) {
              return { allowed: false, reason: `User rejected git operation in "${args.workingDir}".` };
            }
          }
        }
        return { allowed: true };
      }

      case 'git_add_commit': {
        if (args.workingDir && args.workingDir !== '.') {
          const pathValidation = validateSafePath(args.workingDir, this.baseDir, this._pathOptions());
          if (!pathValidation.isAllowed && !this.autoApprove) {
            const confirmed = await this.promptConfirmation(
              `AI wants to commit in directory outside workspace: "${pathValidation.resolvedPath}"`,
            );
            if (!confirmed) {
              return { allowed: false, reason: `User rejected git commit in "${args.workingDir}".` };
            }
          }
        }
        if (!this.autoApprove) {
          const confirmed = await this.promptConfirmation(
            `AI wants to stage ${(args.files || ['.']).join(', ')} and commit:\n  ${args.message}\nProceed?`,
          );
          if (!confirmed) {
            return { allowed: false, reason: 'User denied git commit.' };
          }
        }
        return { allowed: true };
      }
```

- [ ] **Step 7: Run tests**

Run: `node --test tests/cat1-git.test.js && npm test`
Expected: PASS. (If `git` is missing from PATH the suite fails — it is present in this environment.)

- [ ] **Step 8: Commit**

```bash
git add src/tools/git.js src/tools/registry.js src/tools/index.js src/security/guard.js tests/cat1-git.test.js
git commit -m "feat(tools): add git_status, git_diff, git_add_commit tools"
```

---

### Task 5: `web_fetch` tool

**Files:**
- Create: `src/utils/html.js`
- Create: `src/tools/web_fetch.js`
- Modify: `src/tools/registry.js`, `src/tools/index.js`, `src/security/guard.js`
- Test: `tests/cat1-web.test.js`

Design notes:
- Built-in `fetch`, `AbortSignal.timeout(ms)` — no deps.
- `context.fetch` injectable so tests stub the network.
- SSRF guard: reject non-http(s) schemes and obvious local/loopback hosts before fetching.
- HTML → text via `stripHtml` (script/style dropped first), entity-decoded, truncated to `maxBytes`.

- [ ] **Step 1: Write the failing test**

Create `tests/cat1-web.test.js`:

```js
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { SecurityGuard } from '../src/security/guard.js';
import { dispatchToolCall } from '../src/tools/registry.js';
import { webFetchTool } from '../src/tools/web_fetch.js';
import { decodeEntities, stripHtml } from '../src/utils/html.js';

/** Minimal Response-like object accepted by webFetchTool's fetch contract. */
function fakeResponse({ status = 200, body = '', contentType = 'text/html' }) {
  return {
    status,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    text: async () => body,
  };
}

describe('html utils', () => {
  test('stripHtml removes tags, script and style', () => {
    const html =
      '<html><head><style>b{}</style><script>x()</script></head><body><h1>Hi</h1><p>a b</p></body></html>';
    const text = stripHtml(html);
    assert.ok(!text.includes('<'));
    assert.ok(text.includes('Hi'));
    assert.ok(text.includes('a b'));
    assert.ok(!text.includes('x()'));
  });

  test('decodeEntities handles named and numeric refs', () => {
    assert.equal(decodeEntities('&amp;&lt;&gt;&quot;&#39;&nbsp;'), '&<>"\' ');
    assert.equal(decodeEntities('&#65;&#x42;'), 'AB');
  });
});

describe('web_fetch tool', () => {
  test('fetches and converts HTML to text', async () => {
    const fetchStub = async () => fakeResponse({ body: '<h1>Title</h1><p>Body &amp; more</p>' });
    const res = await webFetchTool({ url: 'https://example.com' }, { fetch: fetchStub });
    assert.equal(res.status, 200);
    assert.ok(res.content.includes('Title'));
    assert.ok(res.content.includes('Body & more'));
  });

  test('rejects non-http(s) schemes', async () => {
    await assert.rejects(
      () => webFetchTool({ url: 'file:///etc/passwd' }, {}),
      /http\(s\)|scheme/i,
    );
  });

  test('rejects loopback hosts (SSRF guard)', async () => {
    const urls = ['http://localhost/x', 'http://127.0.0.1/x', 'http://169.254.1.1/x', 'http://[::1]/x'];
    for (const url of urls) {
      await assert.rejects(
        () => webFetchTool({ url }, { fetch: async () => fakeResponse({}) }),
        /blocked|private|loopback|local/i,
      );
    }
  });

  test('truncates long content', async () => {
    const fetchStub = async () =>
      fakeResponse({ body: 'a'.repeat(100000), contentType: 'text/plain' });
    const res = await webFetchTool(
      { url: 'https://example.com', maxBytes: 1000 },
      { fetch: fetchStub },
    );
    assert.equal(res.truncated, true);
    assert.ok(res.content.length <= 1100);
  });

  test('timeout aborts the request', async () => {
    const fetchStub = async () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    };
    await assert.rejects(
      () => webFetchTool({ url: 'https://slow.example.com', timeoutMs: 10 }, { fetch: fetchStub }),
      /timed out|timeout|abort/i,
    );
  });

  test('registered and dispatchable', async () => {
    const out = await dispatchToolCall(
      'web_fetch',
      { url: 'https://example.com' },
      { fetch: async () => fakeResponse({ body: '<p>ok</p>' }) },
    );
    assert.equal(out.success, true);
    assert.ok(out.result.content.includes('ok'));
  });

  test('guard blocks non-http url without prompting', async () => {
    const guard = new SecurityGuard({ baseDir: process.cwd(), autoApprove: false });
    const out = await dispatchToolCall(
      'web_fetch',
      { url: 'ftp://example.com' },
      { securityGuard: guard },
    );
    assert.equal(out.error, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/cat1-web.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `../src/utils/html.js`.

- [ ] **Step 3: Implement `src/utils/html.js`**

```js
/**
 * Minimal HTML → plain-text conversion for web tools.
 * Not a parser: strip-and-decode is enough for LLM consumption.
 */

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '-',
  mdash: '-',
  hellip: '…',
};

/** Decodes named, decimal, and hex HTML entities. */
export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (match, ref) => {
    if (ref[0] === '#') {
      const code =
        ref[1] === 'x' || ref[1] === 'X'
          ? Number.parseInt(ref.slice(2), 16)
          : Number.parseInt(ref.slice(1), 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return match;
    }
    return NAMED_ENTITIES[ref] ?? NAMED_ENTITIES[ref.toLowerCase()] ?? match;
  });
}

/** Strips tags, script/style blocks, and collapses whitespace. */
export function stripHtml(html) {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  text = decodeEntities(text);
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
```

- [ ] **Step 4: Implement `src/tools/web_fetch.js`**

```js
/**
 * Tool: web_fetch
 * Fetch a URL and return readable text (HTML stripped). Built-in fetch only.
 */

import { stripHtml } from '../utils/html.js';

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_BYTES = 100 * 1024;

/** SSRF guard: block non-http(s) schemes and local/private hosts. */
function assertSafeUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: "${rawUrl}"`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Only http(s) URLs are allowed, got "${url.protocol}"`);
  }
  const host = url.hostname.toLowerCase();
  const blocked =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '0.0.0.0' ||
    host === '[::1]' ||
    host === '::' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host);
  if (blocked) {
    throw new Error(`URL blocked by security policy (private/loopback host): "${host}"`);
  }
  return url;
}

/**
 * @param {object} args
 * @param {string} args.url - http(s) URL
 * @param {number} [args.timeoutMs=15000]
 * @param {number} [args.maxBytes=102400]
 * @param {object} [context={}] - may inject context.fetch for tests
 * @returns {Promise<object>}
 */
export async function webFetchTool(args = {}, context = {}) {
  const { url: rawUrl, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES } = args;
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('Missing or invalid "url" argument');
  }
  const url = assertSafeUrl(rawUrl);

  const doFetch = context.fetch || fetch;
  let response;
  try {
    response = await doFetch(url.toString(), {
      signal: AbortSignal.timeout(Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS)),
      redirect: 'follow',
      headers: { 'User-Agent': 'faycli/1.0 (+https://github.com/FAYnim/FAY-CLI)' },
    });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms: "${url}"`);
    }
    throw new Error(`Fetch failed for "${url}": ${err.message || String(err)}`);
  }

  const contentType = response.headers?.get?.('content-type') || '';
  const rawText = await response.text();

  let content = contentType.includes('html') ? stripHtml(rawText) : rawText;
  let truncated = false;
  const limit = Math.max(1024, Number(maxBytes) || DEFAULT_MAX_BYTES);
  if (Buffer.byteLength(content, 'utf-8') > limit) {
    content = `${content.slice(0, limit)}\n... [Content truncated at ${limit} bytes]`;
    truncated = true;
  }

  return {
    url: url.toString(),
    status: response.status,
    contentType,
    content,
    truncated,
    sizeBytes: Buffer.byteLength(rawText, 'utf-8'),
  };
}
```

- [ ] **Step 5: Register in `src/tools/registry.js`**

Import: `import { webFetchTool } from './web_fetch.js';`
`TOOLS_MAP`: `web_fetch: webFetchTool,`
`TOOL_DECLARATIONS`:

```js
  {
    name: 'web_fetch',
    description:
      'Fetch a URL and return its content as readable text (HTML is stripped). Only public http(s) URLs; local/private hosts are blocked.',
    parameters: {
      type: 'OBJECT',
      properties: {
        url: { type: 'STRING', description: 'http(s) URL to fetch' },
        timeoutMs: { type: 'INTEGER', description: 'Request timeout in ms (default 15000)' },
        maxBytes: { type: 'INTEGER', description: 'Max content bytes returned (default 102400)' },
      },
      required: ['url'],
    },
  },
```

`TOOL_ARG_ALIASES`:

```js
  web_fetch: [{ target: 'url', aliases: ['href', 'link', 'uri', 'target'] }],
```

- [ ] **Step 6: Export from `src/tools/index.js`**

```js
export * from './web_fetch.js';
```

- [ ] **Step 7: Guard case in `src/security/guard.js`**

Add before `default:`:

```js
      case 'web_fetch': {
        const url = args.url;
        if (!url || typeof url !== 'string') {
          return { allowed: false, reason: 'URL must be a non-empty string.' };
        }
        let parsed;
        try {
          parsed = new URL(url);
        } catch {
          return { allowed: false, reason: `Invalid URL: "${url}"` };
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return { allowed: false, reason: `Only http(s) URLs allowed, got "${parsed.protocol}"` };
        }
        if (!this.autoApprove) {
          const confirmed = await this.promptConfirmation(
            `AI wants to fetch external URL:\n  ${url}\nProceed?`,
          );
          if (!confirmed) {
            return { allowed: false, reason: `User rejected fetching "${url}".` };
          }
        }
        return { allowed: true };
      }
```

- [ ] **Step 8: Run tests**

Run: `node --test --test-name-pattern="html utils|web_fetch tool" tests/cat1-web.test.js`
Expected: PASS (web_search tests come in Task 6; name-pattern keeps this checkpoint green).
Run: `npm test`
Expected: all suites pass.

- [ ] **Step 9: Commit**

```bash
git add src/utils/html.js src/tools/web_fetch.js src/tools/registry.js src/tools/index.js src/security/guard.js tests/cat1-web.test.js
git commit -m "feat(tools): add web_fetch tool with SSRF guard and html-to-text"
```

---

### Task 6: `web_search` tool

**Files:**
- Create: `src/tools/web_search.js`
- Modify: `src/tools/registry.js`, `src/tools/index.js`, `src/security/guard.js`
- Test: `tests/cat1-web.test.js` (append)

Design notes:
- DuckDuckGo Lite endpoint (`https://lite.duckduckgo.com/lite/?q=...`) — no API key, parseable HTML table.
- Endpoint overridable via config `webSearch.endpoint` (SearXNG self-hosted: `https://searx.example/?q={query}`) read with try/catch like `guard.js:_pathOptions`.
- `context.fetch` injectable.

- [ ] **Step 1: Write the failing test**

Append to `tests/cat1-web.test.js` (and add import at top: `import { webSearchTool } from '../src/tools/web_search.js';`):

```js
describe('web_search tool', () => {
  const liteHtml = `
    <html><body><table>
      <tr><td><a rel="nofollow" href="https://nodejs.org/api.html">Node.js docs</a></td></tr>
      <tr><td>Official Node.js documentation site.</td></tr>
      <tr><td><a rel="nofollow" href="https://expressjs.com/">Express</a></td></tr>
      <tr><td>Fast web framework for Node.</td></tr>
    </table></body></html>`;

  test('parses DDG Lite results', async () => {
    const fetchStub = async (url) => {
      assert.ok(String(url).includes('q=node%20test') || String(url).includes('q=node+test'));
      return fakeResponse({ body: liteHtml, contentType: 'text/html' });
    };
    const res = await webSearchTool({ query: 'node test' }, { fetch: fetchStub });
    assert.equal(res.results.length, 2);
    assert.equal(res.results[0].title, 'Node.js docs');
    assert.equal(res.results[0].url, 'https://nodejs.org/api.html');
    assert.ok(res.results[0].snippet.includes('Official'));
  });

  test('empty result set is not an error', async () => {
    const fetchStub = async () => fakeResponse({ body: '<html><body>No results</body></html>' });
    const res = await webSearchTool({ query: 'zzz' }, { fetch: fetchStub });
    assert.deepEqual(res.results, []);
  });

  test('missing query throws', async () => {
    await assert.rejects(
      () => webSearchTool({}, { fetch: async () => fakeResponse({}) }),
      /query/,
    );
  });

  test('registered and dispatchable', async () => {
    const out = await dispatchToolCall(
      'web_search',
      { query: 'x' },
      { fetch: async () => fakeResponse({ body: liteHtml }) },
    );
    assert.equal(out.success, true);
    assert.equal(out.result.results.length, 2);
  });

  test('guard prompts before searching', async () => {
    let prompted = false;
    const guard = new SecurityGuard({
      baseDir: process.cwd(),
      confirmationHandler: async () => {
        prompted = true;
        return true;
      },
    });
    const out = await dispatchToolCall(
      'web_search',
      { query: 'hello' },
      { securityGuard: guard, fetch: async () => fakeResponse({ body: '' }) },
    );
    assert.equal(out.success, true);
    assert.ok(prompted);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="web_search tool" tests/cat1-web.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `../src/tools/web_search.js`.

- [ ] **Step 3: Implement `src/tools/web_search.js`**

```js
/**
 * Tool: web_search
 * Keyless web search via DuckDuckGo Lite (default) or a self-hosted SearXNG
 * endpoint (config `webSearch.endpoint`, may contain a {query} placeholder).
 */

import { configManager } from '../config/manager.js';
import { decodeEntities, stripHtml } from '../utils/html.js';

const DDG_LITE = 'https://lite.duckduckgo.com/lite/';
const DEFAULT_TIMEOUT_MS = 15000;

function resolveEndpoint(engine) {
  let configured = null;
  try {
    configured = configManager.get('webSearch.endpoint');
  } catch {
    // config unavailable (tests) — fall through to default
  }
  if (engine === 'searxng' && typeof configured === 'string' && configured) {
    return configured;
  }
  return DDG_LITE;
}

/**
 * Parse DDG-Lite / SearXNG result HTML: anchors with http href + their text;
 * snippet = stripped text between the link and the next anchor.
 */
function parseResults(html) {
  const results = [];
  const linkRe = /<a[^>]+href="(http[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkRe.exec(html)) !== null) {
    const url = decodeEntities(match[1]);
    const title = stripHtml(match[2]);
    if (!title || url.includes('duckduckgo.com')) continue;
    const rest = html.slice(match.index + match[0].length);
    const nextAnchor = rest.search(/<a\b/i);
    const snippetChunk = nextAnchor >= 0 ? rest.slice(0, nextAnchor) : rest.slice(0, 600);
    const snippet = stripHtml(snippetChunk).slice(0, 300);
    results.push({ title, url, snippet });
    if (results.length >= 20) break;
  }
  return results;
}

/**
 * @param {object} args
 * @param {string} args.query
 * @param {number} [args.maxResults=8]
 * @param {string} [args.engine='duckduckgo'] - "duckduckgo" or "searxng"
 * @param {object} [context={}]
 */
export async function webSearchTool(args = {}, context = {}) {
  const { query, maxResults = 8, engine = 'duckduckgo' } = args;
  if (!query || typeof query !== 'string') {
    throw new Error('Missing or invalid "query" argument');
  }

  const endpoint = resolveEndpoint(engine);
  const encoded = encodeURIComponent(query);
  const url = endpoint.includes('{query}')
    ? endpoint.replace('{query}', encoded)
    : `${endpoint}${endpoint.includes('?') ? '&' : '?'}q=${encoded}`;

  const doFetch = context.fetch || fetch;
  let response;
  try {
    response = await doFetch(url, {
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      redirect: 'follow',
      headers: { 'User-Agent': 'faycli/1.0 (+https://github.com/FAYnim/FAY-CLI)' },
    });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new Error(`Search request timed out: "${url}"`);
    }
    throw new Error(`Search failed: ${err.message || String(err)}`);
  }

  const html = await response.text();
  const all = parseResults(html);
  const limit = Math.max(1, Math.min(Number(maxResults) || 8, 20));
  return { query, engine, results: all.slice(0, limit) };
}
```

- [ ] **Step 4: Register in `src/tools/registry.js`**

Import: `import { webSearchTool } from './web_search.js';`
`TOOLS_MAP`: `web_search: webSearchTool,`
`TOOL_DECLARATIONS`:

```js
  {
    name: 'web_search',
    description:
      'Search the web (DuckDuckGo Lite by default; SearXNG if configured). Returns ranked titles, URLs and snippets. Requires user confirmation.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Search query' },
        maxResults: { type: 'INTEGER', description: 'Max results (default 8, max 20)' },
        engine: { type: 'STRING', description: '"duckduckgo" (default) or "searxng"' },
      },
      required: ['query'],
    },
  },
```

`TOOL_ARG_ALIASES`:

```js
  web_search: [{ target: 'query', aliases: ['q', 'search', 'searchQuery', 'keywords'] }],
```

- [ ] **Step 5: Export from `src/tools/index.js`**

```js
export * from './web_search.js';
```

- [ ] **Step 6: Guard case in `src/security/guard.js`**

Add before `default:`:

```js
      case 'web_search': {
        if (!args.query || typeof args.query !== 'string') {
          return { allowed: false, reason: 'Search query must be a non-empty string.' };
        }
        if (!this.autoApprove) {
          const confirmed = await this.promptConfirmation(
            `AI wants to search the web for:\n  ${args.query}\nProceed?`,
          );
          if (!confirmed) {
            return { allowed: false, reason: `User rejected web search for "${args.query}".` };
          }
        }
        return { allowed: true };
      }
```

- [ ] **Step 7: Run tests**

Run: `node --test tests/cat1-web.test.js && npm test`
Expected: PASS (all web tests + full suite).

- [ ] **Step 8: Commit**

```bash
git add src/tools/web_search.js src/tools/registry.js src/tools/index.js src/security/guard.js tests/cat1-web.test.js
git commit -m "feat(tools): add web_search tool via DuckDuckGo Lite / SearXNG"
```

---

### Task 7: Project root auto-detection

**Files:**
- Create: `src/utils/project.js`
- Modify: `src/agent/system-prompt.js` (env block + tool list), `src/agent/orchestrator.js:49`, `src/cli/repl.js:49`
- Test: `tests/cat1-project.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/cat1-project.test.js`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { buildSystemPrompt } from '../src/agent/system-prompt.js';
import { findProjectRoot, PROJECT_MARKERS } from '../src/utils/project.js';

describe('findProjectRoot', () => {
  let tmp;
  before(() => {
    tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'faycli-proj-test-'));
    fs.mkdirSync(path.join(tmp, 'packages', 'app', 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'package.json'), '{}');
    fs.mkdirSync(path.join(tmp, '.git'));
  });
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  test('walks up to the nearest marker', () => {
    const root = findProjectRoot(path.join(tmp, 'packages', 'app', 'src'));
    assert.equal(fs.realpathSync(root), fs.realpathSync(tmp));
  });

  test('detects nested package.json as its own root', () => {
    const nested = path.join(tmp, 'packages', 'app');
    fs.writeFileSync(path.join(nested, 'package.json'), '{}');
    try {
      const root = findProjectRoot(path.join(nested, 'src'));
      assert.equal(fs.realpathSync(root), fs.realpathSync(nested));
    } finally {
      fs.rmSync(path.join(nested, 'package.json'));
    }
  });

  test('returns start dir when no marker found', () => {
    const bare = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'faycli-bare-'));
    try {
      assert.equal(findProjectRoot(bare), fs.realpathSync(bare));
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });

  test('markers list covers git and node ecosystems', () => {
    assert.ok(PROJECT_MARKERS.includes('.git'));
    assert.ok(PROJECT_MARKERS.includes('package.json'));
  });
});

describe('system prompt project context', () => {
  test('includes Project Root line when root differs from workingDir', () => {
    const prompt = buildSystemPrompt({
      workingDir: '/home/user/repo/src',
      projectRoot: '/home/user/repo',
    });
    assert.ok(prompt.includes('**Project Root**: /home/user/repo'));
  });

  test('omits Project Root line when equal to workingDir', () => {
    const prompt = buildSystemPrompt({
      workingDir: '/home/user/repo',
      projectRoot: '/home/user/repo',
    });
    assert.ok(!prompt.includes('Project Root'));
  });

  test('tool list mentions the new tools', () => {
    const prompt = buildSystemPrompt({});
    for (const name of [
      'grep_file',
      'search_files',
      'git_status',
      'git_diff',
      'git_add_commit',
      'web_fetch',
      'web_search',
    ]) {
      assert.ok(prompt.includes(name), `system prompt missing ${name}`);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/cat1-project.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `../src/utils/project.js`.

- [ ] **Step 3: Implement `src/utils/project.js`**

```js
/**
 * Project root auto-detection.
 * Walks up from a start directory looking for well-known markers.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Marker files/dirs that identify a project root. */
export const PROJECT_MARKERS = [
  '.git',
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'go.mod',
  'Cargo.toml',
  'composer.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Makefile',
  'CMakeLists.txt',
];

/**
 * Find the nearest project root at or above startDir.
 * Returns startDir itself when no marker exists.
 *
 * @param {string} [startDir=process.cwd()]
 * @param {string[]} [markers=PROJECT_MARKERS]
 * @returns {string} absolute path
 */
export function findProjectRoot(startDir = process.cwd(), markers = PROJECT_MARKERS) {
  let dir;
  try {
    dir = fs.realpathSync(path.resolve(startDir));
  } catch {
    return path.resolve(startDir);
  }
  for (;;) {
    if (markers.some((m) => fs.existsSync(path.join(dir, m)))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return dir; // filesystem root, no marker anywhere
    }
    dir = parent;
  }
}
```

- [ ] **Step 4: Wire into `src/agent/system-prompt.js`**

(a) Add import at top (after `import os from 'node:os';`):

```js
import { findProjectRoot } from '../utils/project.js';
```

(b) In `detectEnvironment`, after `const cwd = overrides.workingDir || process.cwd();` add:

```js
  const projectRoot = overrides.projectRoot || findProjectRoot(cwd);
```

and add `projectRoot,` to the returned object after `workingDir: cwd,`.

(c) In `buildSystemPrompt`, pass the override through — change the `detectEnvironment` call to:

```js
  const envInfo = detectEnvironment({
    workingDir: options.workingDir,
    projectRoot: options.projectRoot,
    ...(options.envOverrides || {}),
  });
```

(d) Replace the environment-context `parts.push(...)` template literal with a conditional line list:

```js
  const envLines = [
    '### ACTIVE ENVIRONMENT CONTEXT:',
    `- **Operating System**: ${envInfo.osType} (${envInfo.platform} / ${envInfo.arch})`,
    `- **Is Termux**: ${envInfo.isTermux ? 'Yes (Native Android Shell)' : 'No (Standard Host)'}`,
    `- **Working Directory**: ${envInfo.workingDir}`,
  ];
  if (envInfo.projectRoot && envInfo.projectRoot !== envInfo.workingDir) {
    envLines.push(`- **Project Root**: ${envInfo.projectRoot}`);
  }
  envLines.push(
    `- **Node.js Version**: ${envInfo.nodeVersion}`,
    `- **Shell**: ${envInfo.shell}`,
    `- **User**: ${envInfo.username}`,
    `- **Current Timestamp**: ${envInfo.datetime} (${envInfo.timezone})`,
  );
  parts.push(envLines.join('\n'));
```

(e) Update the tool list line in `DEFAULT_AGENT_INSTRUCTIONS` (currently line 83) to:

```
   - You have access to local tools: \`write_file\`, \`read_file\`, \`patch_file\`, \`list_dir\`, \`execute_command\`, \`grep_file\`, \`search_files\`, \`git_status\`, \`git_diff\`, \`git_add_commit\`, \`web_fetch\`, \`web_search\`.
```

- [ ] **Step 5: Wire into orchestrator + repl**

`src/agent/orchestrator.js` — add import (with the other `../utils` imports):

```js
import { findProjectRoot } from '../utils/project.js';
```

Change line 49 from:

```js
    this.workingDir = options.workingDir || process.cwd();
```

to:

```js
    this.workingDir = options.workingDir || findProjectRoot(process.cwd());
```

`src/cli/repl.js` — add the same import and change line 49 from:

```js
      workingDir: options.workingDir || process.cwd(),
```

to:

```js
      workingDir: options.workingDir || findProjectRoot(process.cwd()),
```

(`src/cli/single-shot.js:50` forwards `options.workingDir` through — no change; the orchestrator default covers it.)

- [ ] **Step 6: Run tests**

Run: `node --test tests/cat1-project.test.js && npm test`
Expected: PASS. If an existing orchestrator/session test asserts `workingDir === process.cwd()` and now fails, pass `workingDir: process.cwd()` explicitly in that test's options — do NOT weaken the detection.

- [ ] **Step 7: Commit**

```bash
git add src/utils/project.js src/agent/system-prompt.js src/agent/orchestrator.js src/cli/repl.js tests/cat1-project.test.js
git commit -m "feat(agent): auto-detect project root for working dir and system prompt"
```

---

### Task 8: Final wiring — text tool-call names + full verification

**Files:**
- Modify: `src/llm/openai.js:462` (`TEXT_TOOL_NAMES`)
- Test: `tests/cat1-wiring.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/cat1-wiring.test.js`:

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseTextToolCalls } from '../src/llm/openai.js';
import { getToolDeclarations, TOOLS_MAP } from '../src/tools/registry.js';

const CAT1_TOOLS = [
  'grep_file',
  'search_files',
  'git_status',
  'git_diff',
  'git_add_commit',
  'web_fetch',
  'web_search',
];

test('all Kategori 1 tools are registered', () => {
  for (const name of CAT1_TOOLS) {
    assert.equal(typeof TOOLS_MAP[name], 'function', `${name} missing from TOOLS_MAP`);
  }
});

test('every registered tool has a declaration', () => {
  const decls = getToolDeclarations();
  const declared = new Set(decls.map((d) => d.name));
  for (const name of Object.keys(TOOLS_MAP)) {
    assert.ok(declared.has(name), `${name} has no TOOL_DECLARATIONS entry`);
  }
  assert.equal(decls.length, Object.keys(TOOLS_MAP).length);
});

test('text tool-call parser recognizes every registered tool', () => {
  for (const name of Object.keys(TOOLS_MAP)) {
    const calls = parseTextToolCalls(
      `<tool_calls>${name}<tool_sep>{"pattern": "x"}</tool_calls>`,
    );
    assert.equal(calls.length, 1, `${name} not parseable from text`);
    assert.equal(calls[0].name, name);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/cat1-wiring.test.js`
Expected: FAIL on the third test — `grep_file` not in `TEXT_TOOL_NAMES` yet.

- [ ] **Step 3: Update `src/llm/openai.js:462`**

```js
const TEXT_TOOL_NAMES = [
  'read_file',
  'write_file',
  'patch_file',
  'list_dir',
  'execute_command',
  'grep_file',
  'search_files',
  'git_status',
  'git_diff',
  'git_add_commit',
  'web_fetch',
  'web_search',
];
```

- [ ] **Step 4: Run full verification**

Run: `node --test tests/cat1-wiring.test.js`
Expected: PASS.
Run: `npm test`
Expected: ALL suites pass (existing 40+ plus the new cat1 files).
Run: `npm run lint`
Expected: no errors (fix Biome complaints in new files with `npm run lint:fix`).

- [ ] **Step 5: Manual smoke test (no network needed)**

```bash
node -e "import('./src/tools/registry.js').then(async (m) => {
  const r = await m.dispatchToolCall('grep_file', { pattern: 'registry' }, { baseDir: 'src' });
  console.log('grep ok:', r.success, r.result.totalMatches > 0);
  const s = await m.dispatchToolCall('search_files', { pattern: '*.js' }, { baseDir: 'src' });
  console.log('search ok:', s.success, s.result.files.length > 0);
});"
```

Expected: `grep ok: true true` and `search ok: true true`.

- [ ] **Step 6: Commit**

```bash
git add src/llm/openai.js tests/cat1-wiring.test.js
git commit -m "feat(llm): register Kategori 1 tools in text tool-call parser"
```

---

## Spec Coverage Check (features.md Kategori 1)

| # | Feature | Task |
|---|---------|------|
| 1 | `grep_file` | Task 2 |
| 2 | `search_files` | Task 3 |
| 3 | Git tools `git_status`/`git_diff`/`git_add_commit` | Task 4 |
| 4 | `web_fetch` | Task 5 |
| 5 | `web_search` (DuckDuckGo/SearXNG gratis) | Task 6 |
| 6 | Project root auto-detection | Task 7 |

## Deliberate Simplifications (ponytail notes)

- `globToRegExp` has no brace expansion `{a,b}` or char classes `[abc]` — models rarely need them; extend the char switch in `src/utils/glob.js` when a real prompt shows the need.
- `web_search` DDG-Lite parsing is regex-based and breaks if DDG changes markup — acceptable for a keyless free endpoint; `webSearch.endpoint` SearXNG config is the escape hatch.
- `git_add_commit` does not push; `git_status` has no ahead/behind counts — push is a separate risky operation, add `git_push` only when requested.
- `findProjectRoot` is sync (`fs.existsSync`) — called once at orchestrator construction, not in a hot loop.
- No `.gitignore`-aware filtering beyond `DEFAULT_IGNORE_PATTERNS` — dependency-free (Termux); add ignore-file parsing when noise becomes a real complaint.
