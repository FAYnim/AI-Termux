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
    const res = await grepFileTool({ pattern: 'w.rld' }, { baseDir: dir });
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
    await assert.rejects(
      () => grepFileTool({ pattern: '([' }, { baseDir: dir }),
      /Invalid regex/,
    );
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
