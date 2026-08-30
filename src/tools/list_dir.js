/**
 * Tool: list_dir
 * Recursive directory tree walker with depth control and automatic ignore filtering.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_IGNORE_PATTERNS } from '../security/rules.js';

/**
 * Format bytes into human readable string
 * @param {number} bytes
 * @returns {string}
 */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Lists directory entries recursively up to a specified depth.
 *
 * @param {object} args
 * @param {string} [args.dirPath='.'] - Starting directory path
 * @param {number} [args.depth=2] - Maximum recursion depth
 * @param {string[]} [args.ignorePatterns] - Custom patterns to ignore
 * @param {object} [context={}]
 * @returns {Promise<object>}
 */
export async function listDirTool(args = {}, context = {}) {
  const { dirPath = '.', depth = 2, ignorePatterns } = args;

  const resolvedBase = path.resolve(context.baseDir || process.cwd(), dirPath);

  // BUG-04: async I/O — never blocks the event loop
  let stat;
  try {
    stat = await fsp.stat(resolvedBase);
  } catch {
    throw new Error(`Directory not found: "${dirPath}"`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Path is a file, not a directory: "${dirPath}". Use "read_file" instead.`);
  }

  const ignores = new Set(Array.isArray(ignorePatterns) ? ignorePatterns : DEFAULT_IGNORE_PATTERNS);

  const maxDepth = Math.max(1, Math.min(typeof depth === 'number' ? Math.floor(depth) : 2, 10));

  let totalFiles = 0;
  let totalDirs = 0;
  const entries = [];

  /**
   * Helper to build tree string and collect entries
   */
  async function walk(currentDir, currentDepth, prefix = '') {
    if (currentDepth > maxDepth) {
      return [];
    }

    let items;
    try {
      // BUG-04: async I/O — never blocks the event loop on large dirs
      items = await fsp.readdir(currentDir, { withFileTypes: true });
    } catch (_err) {
      return [`${prefix}└── [Permission Denied / Read Error]`];
    }

    // Sort: directories first, then files alphabetically
    const filteredItems = items
      .filter((item) => !ignores.has(item.name))
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

    const lines = [];

    for (let index = 0; index < filteredItems.length; index++) {
      const item = filteredItems[index];
      const isLast = index === filteredItems.length - 1;
      const pointer = isLast ? '└── ' : '├── ';
      const nextPrefix = prefix + (isLast ? '    ' : '│   ');
      const itemPath = path.join(currentDir, item.name);
      const relPath = path.relative(resolvedBase, itemPath);

      if (item.isDirectory()) {
        totalDirs++;
        entries.push({
          name: item.name,
          relativePath: relPath,
          type: 'directory',
        });
        lines.push(`${prefix}${pointer}${item.name}/`);

        const subLines = await walk(itemPath, currentDepth + 1, nextPrefix);
        lines.push(...subLines);
      } else {
        totalFiles++;
        let size = 0;
        try {
          size = (await fsp.stat(itemPath)).size;
        } catch {
          // ignore stat error
        }

        entries.push({
          name: item.name,
          relativePath: relPath,
          type: 'file',
          sizeBytes: size,
        });

        lines.push(`${prefix}${pointer}${item.name} (${formatSize(size)})`);
      }
    }

    return lines;
  }

  const rootName = path.basename(resolvedBase) || dirPath;
  const treeLines = [`${rootName}/`, ...(await walk(resolvedBase, 1, ''))];
  const tree = treeLines.join('\n');

  return {
    dirPath,
    totalFiles,
    totalDirs,
    depth: maxDepth,
    entries,
    tree,
  };
}
