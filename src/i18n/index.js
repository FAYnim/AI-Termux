/**
 * Minimal i18n layer.
 * Loads locale dictionaries from `locales/<locale>.json` (en is always kept
 * as fallback) and exposes a sync `t(key, params, localeOverride)` translator
 * with `{param}` interpolation.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCALES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'locales');
const DEFAULT_LOCALE = 'en';

/** @type {Map<string, object>} */
const dictionaries = new Map();
let currentLocale = DEFAULT_LOCALE;

/**
 * Loads and caches a locale dictionary. Also pre-loads `en` so per-key
 * fallback always has data. Unknown locale names fall back to `en` silently.
 *
 * @param {string} [locale] - Locale code, e.g. 'en' or 'id'. Defaults to 'en'.
 * @returns {Promise<string>} The locale that is now active.
 */
export async function loadLocale(locale = DEFAULT_LOCALE) {
  await ensureDictionary(DEFAULT_LOCALE);
  const requested = typeof locale === 'string' && locale.trim() ? locale.trim() : DEFAULT_LOCALE;
  const loaded = await ensureDictionary(requested);
  currentLocale = loaded;
  return currentLocale;
}

/**
 * Currently active locale (set by the last `loadLocale` call).
 *
 * @returns {string}
 */
export function getLocale() {
  return currentLocale;
}

/**
 * Translates a key in the active locale (or `localeOverride` if given).
 * Falls back to `en` for missing keys, then to the raw key name.
 *
 * @param {string} key
 * @param {Record<string, string|number>} [params] - `{param}` placeholder values
 * @param {string} [localeOverride] - Translate in this locale instead of the active one
 * @returns {string}
 */
export function t(key, params, localeOverride) {
  const locale = localeOverride || currentLocale;
  const template =
    dictionaries.get(locale)?.[key] ?? dictionaries.get(DEFAULT_LOCALE)?.[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}

async function ensureDictionary(locale) {
  if (dictionaries.has(locale)) return locale;
  try {
    const raw = await readFile(path.join(LOCALES_DIR, `${locale}.json`), 'utf8');
    dictionaries.set(locale, JSON.parse(raw));
    return locale;
  } catch {
    return DEFAULT_LOCALE;
  }
}
