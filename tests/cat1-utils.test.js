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
    for await (const entry of walkFiles(dir, {
      ignores: new Set(['node_modules']),
      maxEntries: 1,
    })) {
      assert.ok(entry.fullPath);
      count++;
    }
    assert.equal(count, 1);
  });
});
