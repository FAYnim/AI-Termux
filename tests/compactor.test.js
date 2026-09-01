/**
 * Unit tests: context compactor (LLM summary, digest fallback, archive,
 * boundary safety, abort semantics). Stub llmClient — no network.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { compactSession, splitForCompact, COMPACT_KEEP_RECENT } from '../src/agent/compactor.js';
import { Session } from '../src/agent/session.js';

function turn(i) {
  return [
    { role: 'model', parts: [{ functionCall: { name: 'list_dir', args: { dirPath: `d${i}` } } }] },
    { role: 'function', parts: [{ functionResponse: { name: 'list_dir', response: { content: `out ${i}` } } }] },
  ];
}

function sessionWith(count) {
  const s = new Session({ messages: [{ role: 'user', parts: [{ text: 'original goal' }] }] });
  for (let i = 0; i < count; i++) s.messages.push(...turn(i));
  return s;
}

let tempDir;
beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'termuxai-compact-test-'));
});
afterEach(() => {
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
});

describe('splitForCompact', () => {
  test('empty head when history fits in keep window', () => {
    const { head, tail } = splitForCompact(sessionWith(2).messages, 10);
    assert.equal(head.length, 0);
    assert.ok(tail.length > 0);
  });

  test('tail never starts with an orphan function response', () => {
    // 20 turns = 41 messages; boundary lands mid-pair on a function msg
    const { head, tail } = splitForCompact(sessionWith(20).messages, COMPACT_KEEP_RECENT);
    assert.notEqual(tail[0].role, 'function');
    // Every function msg in tail has its model call in tail too
    for (let i = 0; i < tail.length; i++) {
      if (tail[i].role === 'function') {
        assert.equal(tail[i - 1].role, 'model');
        assert.ok(tail[i - 1].parts.some((p) => p.functionCall));
      }
    }
    assert.ok(head.length > 0);
  });
});

describe('compactSession', () => {
  test('LLM success: [summary, ...tail], archive holds head, metadata set', async () => {
    const session = sessionWith(20);
    session.sessionsDir = tempDir;
    const archivePath = path.join(tempDir, `${session.id}.archive.jsonl`);
    const client = { generate: async () => ({ text: 'SUMMARY TEXT' }) };

    const res = await compactSession(session, client, { archivePath });
    assert.equal(res.compacted, true);
    assert.equal(res.method, 'llm');

    const msgs = session.getMessages();
    assert.equal(msgs[0].role, 'user');
    assert.match(msgs[0].parts[0].text, /^\[Compact summary\]\nSUMMARY TEXT$/);
    assert.ok(msgs.length <= COMPACT_KEEP_RECENT + 1);

    const archived = fs.readFileSync(archivePath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(archived.length > 0);
    assert.equal(archived[0].parts[0].text, 'original goal');

    assert.equal(session.metadata.lastCompact.method, 'llm');
    assert.ok(session.metadata.lastCompact.tokensBefore >= session.metadata.lastCompact.tokensAfter);
  });

  test('LLM throws → digest fallback, method digest', async () => {
    const session = sessionWith(20);
    const client = { generate: async () => { throw new Error('429 rate limited'); } };
    const res = await compactSession(session, client, {
      archivePath: path.join(tempDir, 'a.jsonl'),
    });
    assert.equal(res.compacted, true);
    assert.equal(res.method, 'digest');
    assert.match(res.error, /429/);
    assert.match(session.getMessages()[0].parts[0].text, /\[Context digest\]/);
  });

  test('LLM returns empty text → digest fallback', async () => {
    const session = sessionWith(20);
    const res = await compactSession(session, { generate: async () => ({ text: '   ' }) }, {});
    assert.equal(res.method, 'digest');
  });

  test('abort during LLM call → rethrows, session untouched, no archive', async () => {
    const session = sessionWith(20);
    const before = session.getMessages().length;
    const controller = new AbortController();
    const archivePath = path.join(tempDir, 'abort.jsonl');
    const client = {
      generate: async () => {
        controller.abort(new Error('User interrupted'));
        throw new Error('Request aborted by user');
      },
    };
    await assert.rejects(
      () => compactSession(session, client, { signal: controller.signal, archivePath }),
      /aborted/i,
    );
    assert.equal(session.getMessages().length, before);
    assert.equal(fs.existsSync(archivePath), false);
  });

  test('nothing to compact → noop, session unchanged', async () => {
    const session = sessionWith(2);
    let called = false;
    const res = await compactSession(session, { generate: async () => { called = true; return { text: 'x' }; } }, {});
    assert.equal(res.compacted, false);
    assert.equal(res.method, 'noop');
    assert.equal(called, false);
  });

  test('archive append failure warns but still compacts', async () => {
    const session = sessionWith(20);
    const warnings = [];
    const res = await compactSession(session, { generate: async () => ({ text: 'S' }) }, {
      archivePath: path.join(tempDir, 'missing-sub', 'deep.jsonl'), // dir does not exist → append fails
      logger: { warn: (m) => warnings.push(m), info: () => {}, error: () => {} },
    });
    assert.equal(res.compacted, true);
    assert.ok(warnings.some((w) => /archive/.test(w)));
  });
});
