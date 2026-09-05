/**
 * Async directory walker shared by grep_file and search_files.
 * Iterative (explicit stack, no recursion limit), skips ignored names,
 * bounded by maxEntries so huge trees cannot hang the agent.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * Yields regular files under rootDir.
 *
 * @param {string} rootDir - absolute path
 * @param {object} [options]
 * @param {Set<string>} [options.ignores] - directory/file NAMES to skip
 * @param {number} [options.maxEntries=5000]
 * @yields {{ fullPath: string, relativePath: string }}
 */
export async function* walkFiles(rootDir, { ignores = new Set(), maxEntries = 5000 } = {}) {
  const stack = [rootDir];
  let count = 0;
  while (stack.length > 0) {
    const dir = stack.pop();
    let items;
    try {
      items = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue; // permission denied / race with deletion — skip subtree
    }
    for (const item of items) {
      if (ignores.has(item.name)) continue;
      const full = path.join(dir, item.name);
      if (item.isDirectory()) {
        stack.push(full);
      } else if (item.isFile()) {
        if (++count > maxEntries) return;
        yield { fullPath: full, relativePath: path.relative(rootDir, full) };
      }
    }
  }
}
