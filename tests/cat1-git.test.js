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
      await assert.rejects(
        () => gitStatusTool({}, { baseDir: plain }),
        /not a git repository|git/i,
      );
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });
});
