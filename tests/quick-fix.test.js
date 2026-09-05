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
