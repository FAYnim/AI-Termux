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
