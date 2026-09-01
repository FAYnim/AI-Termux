/**
 * Unit tests: /compact slash command (live-session compaction + noop report).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Session } from '../src/agent/session.js';
import { executeSlashCommand } from '../src/cli/slash-commands.js';

function turn(i) {
  return [
    { role: 'model', parts: [{ functionCall: { name: 'list_dir', args: { dirPath: `d${i}` } } }] },
    {
      role: 'function',
      parts: [{ functionResponse: { name: 'list_dir', response: { content: `o${i}` } } }],
    },
  ];
}

describe('/compact', () => {
  test('compacts live session and reports method', async () => {
    const session = new Session({ messages: [{ role: 'user', parts: [{ text: 'goal' }] }] });
    for (let i = 0; i < 20; i++) session.messages.push(...turn(i));
    const chunks = [];
    const orchestrator = {
      session,
      maxContextTokens: 1000000,
      llmClient: { generate: async () => ({ text: 'S' }), getModel: () => 'm' },
    };
    const res = await executeSlashCommand('/compact', {
      orchestrator,
      configMgr: { get: () => undefined },
      logger: { warn: () => {}, info: () => {}, error: () => {} },
      stream: { write: (c) => chunks.push(String(c)) },
    });
    assert.equal(res.handled, true);
    assert.equal(res.action, 'compact');
    assert.match(chunks.join(''), /llm/);
    assert.match(session.getMessages()[0].parts[0].text, /\[Compact summary\]/);
  });

  test('noop reports nothing to compact', async () => {
    const session = new Session({ messages: [{ role: 'user', parts: [{ text: 'goal' }] }] });
    const chunks = [];
    const res = await executeSlashCommand('/compact', {
      orchestrator: { session, llmClient: { generate: async () => ({ text: 'S' }) } },
      configMgr: { get: () => undefined },
      logger: { warn: () => {}, info: () => {}, error: () => {} },
      stream: { write: (c) => chunks.push(String(c)) },
    });
    assert.equal(res.handled, true);
    assert.match(chunks.join(''), /nothing to compact/i);
  });
});
