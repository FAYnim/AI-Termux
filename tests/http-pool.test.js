/**
 * Tests for the LLM HTTP connection pool wrapper.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  _resetForTests,
  closePool,
  getSharedDispatcher,
  isPoolingActive,
  pooledFetch,
} from '../src/llm/http-pool.js';

describe('http-pool', () => {
  it('falls back to globalThis.fetch when undici is not installed', async () => {
    _resetForTests();
    // undici is not a runtime dep — the dynamic import must fail gracefully
    const dispatcher = await getSharedDispatcher();
    assert.equal(dispatcher, null);
    assert.equal(isPoolingActive(), false);

    // pooledFetch should delegate to the real global fetch and still resolve
    // (using a no-op data: URL to avoid network)
    const res = await pooledFetch('data:text/plain,hello');
    const text = await res.text();
    assert.equal(text, 'hello');
  });

  it('caches the dispatcher lookup so repeated calls do not re-import', async () => {
    _resetForTests();
    const [first, second] = await Promise.all([getSharedDispatcher(), getSharedDispatcher()]);
    assert.equal(first, second);
    closePool();
  });

  it('closePool is idempotent and resets state', async () => {
    _resetForTests();
    await getSharedDispatcher();
    closePool();
    closePool();
    assert.equal(isPoolingActive(), false);
  });

  it('pooledFetch signature accepts standard fetch init options', async () => {
    _resetForTests();
    const res = await pooledFetch('data:application/json,{"ok":true}', {
      headers: { 'X-Test': '1' },
    });
    const body = await res.json();
    assert.equal(body.ok, true);
  });
});
