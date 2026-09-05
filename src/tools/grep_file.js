/**
 * Tool: grep_file
 * Recursive regex text search across the workspace, with glob filtering,
 * ignore-list protection, and result caps to bound token usage.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { isBinaryFile } from '../security/path-validator.js';
import { DEFAULT_IGNORE_PATTERNS, DEFAULT_SECURITY_CONFIG } from '../security/rules.js';
import { walkFiles } from '../utils/fs-walk.js';
import { globToRegExp } from '../utils/glob.js';

const MAX_LINE_PREVIEW = 500;

/**
 * @param {object} args
 * @param {string} args.pattern - JavaScript regex source
 * @param {string} [args.dirPath='.'] - Search root (relative to context.baseDir)
 * @param {string} [args.glob] - File filter glob; without "/" matches basenames at any depth
 * @param {boolean} [args.caseSensitive=false]
 * @param {number} [args.maxResults=100]
 * @param {object} [context={}]
 * @returns {Promise<object>}
 */
export async function grepFileTool(args = {}, context = {}) {
  const { pattern, dirPath = '.', glob, caseSensitive = false, maxResults = 100 } = args;

  if (!pattern || typeof pattern !== 'string') {
    throw new Error('Missing or invalid "pattern" argument (regex source string)');
  }

  let regex;
  try {
    regex = new RegExp(pattern, caseSensitive ? 'g' : 'gi');
  } catch (err) {
    throw new Error(`Invalid regex pattern "${pattern}": ${err.message}`);
  }

  // Same anchoring rule as search_files: a glob without "/" matches basenames.
  let globRe = null;
  if (glob) {
    const normalized = String(glob).split(path.sep).join('/');
    const anchored = normalized.includes('/') ? normalized : `**/${normalized}`;
    globRe = globToRegExp(anchored);
  }

  const resolvedBase = path.resolve(context.baseDir || process.cwd(), dirPath);
  const limit = Math.max(1, Math.min(Number(maxResults) || 100, 1000));
  const maxFileBytes = context.maxReadSizeBytes || DEFAULT_SECURITY_CONFIG.maxReadSizeBytes;

  const matches = [];
  let filesScanned = 0;
  let truncated = false;

  for await (const { fullPath, relativePath } of walkFiles(resolvedBase, {
    ignores: new Set(DEFAULT_IGNORE_PATTERNS),
  })) {
    const posixRel = relativePath.split(path.sep).join('/');
    if (globRe && !globRe.test(posixRel)) continue;

    let stat;
    try {
      stat = await fsp.stat(fullPath);
    } catch {
      continue;
    }
    if (stat.size > maxFileBytes) continue;
    if (isBinaryFile(fullPath)) continue;

    let text;
    try {
      text = await fsp.readFile(fullPath, 'utf-8');
    } catch {
      continue;
    }

    filesScanned++;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      regex.lastIndex = 0;
      if (!regex.test(lines[i])) continue;
      matches.push({
        file: posixRel,
        line: i + 1,
        content: lines[i].slice(0, MAX_LINE_PREVIEW),
      });
      if (matches.length >= limit) {
        truncated = true;
        break;
      }
    }
    if (truncated) break;
  }

  return { pattern, matches, totalMatches: matches.length, filesScanned, truncated };
}
