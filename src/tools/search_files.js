/**
 * Tool: search_files
 * Find files by glob pattern. A pattern without "/" matches basenames at any
 * depth (like `find -name`); patterns with "/" match relative paths.
 */

import path from 'node:path';
import { DEFAULT_IGNORE_PATTERNS } from '../security/rules.js';
import { walkFiles } from '../utils/fs-walk.js';
import { globToRegExp } from '../utils/glob.js';

/**
 * @param {object} args
 * @param {string} args.pattern - glob, e.g. "*.js" or "src/*.js"
 * @param {string} [args.dirPath='.'] - Search root
 * @param {number} [args.maxResults=200]
 * @param {object} [context={}]
 * @returns {Promise<object>}
 */
export async function searchFilesTool(args = {}, context = {}) {
  const { pattern, dirPath = '.', maxResults = 200 } = args;

  if (!pattern || typeof pattern !== 'string') {
    throw new Error('Missing or invalid "pattern" argument (glob string)');
  }

  const normalized = pattern.split(path.sep).join('/');
  const anchored = normalized.includes('/') ? normalized : `**/${normalized}`;
  const regex = globToRegExp(anchored);
  const resolvedBase = path.resolve(context.baseDir || process.cwd(), dirPath);
  const limit = Math.max(1, Math.min(Number(maxResults) || 200, 2000));

  const files = [];
  let truncated = false;

  for await (const { relativePath } of walkFiles(resolvedBase, {
    ignores: new Set(DEFAULT_IGNORE_PATTERNS),
  })) {
    const posixRel = relativePath.split(path.sep).join('/');
    if (!regex.test(posixRel)) continue;
    files.push({ path: posixRel });
    if (files.length >= limit) {
      truncated = true;
      break;
    }
  }

  return { pattern, dirPath, files, total: files.length, truncated };
}
