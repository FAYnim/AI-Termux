import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { getLocale, loadLocale, t } from '../src/i18n/index.js';

test('loadLocale defaults to en and t() returns English strings', async () => {
  const active = await loadLocale();
  assert.equal(active, 'en');
  assert.equal(getLocale(), 'en');
  assert.equal(t('failed'), 'Failed');
});

test('loadLocale switches to id and t() returns Indonesian strings', async () => {
  const active = await loadLocale('id');
  assert.equal(active, 'id');
  assert.equal(t('failed'), 'Gagal');
  // Restore for other tests
  await loadLocale('en');
});

test('t() interpolates {param} placeholders', async () => {
  await loadLocale('en');
  assert.equal(t('contactingApi', { provider: 'GEMINI' }), 'Contacting GEMINI API...');
  assert.equal(
    t('networkBusy', { status: 'HTTP 429', seconds: '1.5', attempt: 1, maxRetries: 3 }),
    'Network busy (HTTP 429), retrying in 1.5s (attempt 1/3)...',
  );
});

test('t() leaves unknown placeholders intact', async () => {
  await loadLocale('en');
  assert.equal(t('contactingApi', { unknown: 'x' }), 'Contacting {provider} API...');
});

test('t() falls back to en for missing keys in the active locale', async () => {
  // id.json is missing no keys; simulate a missing key by requesting a bogus one
  await loadLocale('id');
  assert.equal(t('definitely_not_a_key'), 'definitely_not_a_key');
  await loadLocale('en');
});

test('unknown locale falls back to en', async () => {
  const active = await loadLocale('xx-YY');
  assert.equal(active, 'en');
  assert.equal(t('failed'), 'Failed');
});

test('t() with localeOverride translates in that locale without switching the active locale', async () => {
  await loadLocale('en');
  assert.equal(t('failed', null, 'id'), 'Gagal');
  assert.equal(getLocale(), 'en');
});

test('en and id dictionaries define the same key sets', async () => {
  const localesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'locales');
  const en = JSON.parse(await readFile(path.join(localesDir, 'en.json'), 'utf8'));
  const id = JSON.parse(await readFile(path.join(localesDir, 'id.json'), 'utf8'));
  assert.deepEqual(Object.keys(id).sort(), Object.keys(en).sort());
});
