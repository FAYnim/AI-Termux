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

describe('SecurityGuard patch_file diff preview', () => {
  test('writes diff preview to stream and prompts confirmation when before/after content given', async () => {
    const { SecurityGuard } = await import('../src/security/guard.js');
    const written = [];
    const stream = { write: (s) => written.push(s) };
    let promptCalled = false;
    const guard = new SecurityGuard({
      baseDir: process.cwd(),
      stream,
      confirmationHandler: async (opts) => {
        promptCalled = true;
        return true;
      },
    });

    const res = await guard.authorize('patch_file', {
      filePath: 'test.js',
      _beforeContent: 'const a = 1;\n',
      _afterContent: 'const a = 2;\n',
    });

    assert.equal(res.allowed, true);
    assert.equal(promptCalled, true);
    const output = written.join('');
    assert.ok(output.includes('Diff Preview:'));
    assert.ok(output.includes('test.js'));
    assert.ok(output.includes('-const a = 1;'));
    assert.ok(output.includes('+const a = 2;'));
  });

  test('denies patch when user rejects confirmation', async () => {
    const { SecurityGuard } = await import('../src/security/guard.js');
    const written = [];
    const stream = { write: (s) => written.push(s) };
    const guard = new SecurityGuard({
      baseDir: process.cwd(),
      stream,
      confirmationHandler: async () => false,
    });

    const res = await guard.authorize('patch_file', {
      filePath: 'test.js',
      _beforeContent: 'old\n',
      _afterContent: 'new\n',
    });

    assert.equal(res.allowed, false);
    assert.ok(res.reason.includes('rejected patch'));
  });
});

