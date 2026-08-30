import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeToolArgs, TOOL_ARG_ALIASES } from '../src/tools/registry.js';

test('normalizeToolArgs maps filePath aliases for file tools', () => {
  assert.equal(normalizeToolArgs('read_file', { path: 'a.txt' }).filePath, 'a.txt');
  assert.equal(normalizeToolArgs('read_file', { file_path: 'a.txt' }).filePath, 'a.txt');
  assert.equal(normalizeToolArgs('write_file', { destination: 'a.txt' }).filePath, 'a.txt');
  assert.equal(normalizeToolArgs('patch_file', { fileName: 'a.txt' }).filePath, 'a.txt');
});

test('normalizeToolArgs keeps canonical filePath over aliases', () => {
  const args = normalizeToolArgs('read_file', { filePath: 'keep.txt', path: 'drop.txt' });
  assert.equal(args.filePath, 'keep.txt');
  assert.equal(args.path, 'drop.txt');
});

test('normalizeToolArgs maps content aliases for write_file', () => {
  assert.equal(normalizeToolArgs('write_file', { filePath: 'a', text: 'hi' }).content, 'hi');
  assert.equal(normalizeToolArgs('write_file', { filePath: 'a', body: 'hi' }).content, 'hi');
  assert.equal(normalizeToolArgs('write_file', { filePath: 'a', code: 'hi' }).content, 'hi');
});

test('normalizeToolArgs treats empty-string alias as provided content', () => {
  // ?? semantics: an explicit empty string is a defined value, not missing
  const args = normalizeToolArgs('write_file', { filePath: 'a', text: '' });
  assert.equal(args.content, '');
});

test('normalizeToolArgs leaves explicit null content untouched', () => {
  const args = normalizeToolArgs('write_file', { filePath: 'a', content: null, text: 'hi' });
  assert.equal(args.content, null);
});

test('normalizeToolArgs maps command aliases for execute_command', () => {
  assert.equal(normalizeToolArgs('execute_command', { cmd: 'ls' }).command, 'ls');
  assert.equal(normalizeToolArgs('execute_command', { script: 'ls' }).command, 'ls');
  assert.equal(normalizeToolArgs('execute_command', { exec: 'ls' }).command, 'ls');
});

test('normalizeToolArgs defaults list_dir dirPath to "."', () => {
  assert.equal(normalizeToolArgs('list_dir', {}).dirPath, '.');
  assert.equal(normalizeToolArgs('list_dir', { folder: 'src' }).dirPath, 'src');
});

test('normalizeToolArgs maps patch_file search/replace aliases', () => {
  const args = normalizeToolArgs('patch_file', {
    filePath: 'a',
    old_string: 'x',
    newString: 'y',
  });
  assert.equal(args.searchString, 'x');
  assert.equal(args.replaceString, 'y');
});

test('normalizeToolArgs returns unknown tools unchanged (shallow copy)', () => {
  const raw = { weird: 'value', nested: { a: 1 } };
  const args = normalizeToolArgs('no_such_tool', raw);
  assert.deepEqual(args, raw);
  assert.notEqual(args, raw);
});

test('TOOL_ARG_ALIASES covers every registered tool', async () => {
  const { TOOLS_MAP } = await import('../src/tools/registry.js');
  for (const name of Object.keys(TOOLS_MAP)) {
    assert.ok(Array.isArray(TOOL_ARG_ALIASES[name]), `missing alias rules for ${name}`);
  }
});
