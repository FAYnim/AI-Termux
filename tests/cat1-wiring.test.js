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
