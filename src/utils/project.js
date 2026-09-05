/**
 * Project root auto-detection.
 * Walks up from a start directory looking for well-known markers.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Marker files/dirs that identify a project root. */
export const PROJECT_MARKERS = [
  '.git',
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'go.mod',
  'Cargo.toml',
  'composer.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Makefile',
  'CMakeLists.txt',
];

/**
 * Find the nearest project root at or above startDir.
 * Returns startDir itself when no marker exists.
 *
 * @param {string} [startDir=process.cwd()]
 * @param {string[]} [markers=PROJECT_MARKERS]
 * @returns {string} absolute path
 */
export function findProjectRoot(startDir = process.cwd(), markers = PROJECT_MARKERS) {
  let start;
  try {
    start = fs.realpathSync(path.resolve(startDir));
  } catch {
    return path.resolve(startDir);
  }
  let dir = start;
  for (;;) {
    if (markers.some((m) => fs.existsSync(path.join(dir, m)))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return start; // filesystem root reached, no marker anywhere
    }
    dir = parent;
  }
}
