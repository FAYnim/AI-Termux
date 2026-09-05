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
