/**
 * Path Validator & Workspace Boundary Checker
 */

import fs from 'node:fs';
import path from 'node:path';
import { getTermuxAllowedStoragePaths, isTermuxStoragePath } from '../utils/termux.js';
import { BINARY_EXTENSIONS } from './rules.js';

/**
 * Check if targetPath is strictly inside parentDir (or identical to parentDir)
 *
 * @param {string} parentDir
 * @param {string} targetPath
 * @returns {boolean}
 */
export function isPathInside(parentDir, targetPath) {
  const resolvedParent = path.resolve(parentDir);
  const resolvedTarget = path.resolve(targetPath);

  const rel = path.relative(resolvedParent, resolvedTarget);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Resolves a file path and verifies if it falls within the safe working boundary.
 *
 * @param {string} targetPath - Relative or absolute path
 * @param {string} [baseDir=process.cwd()] - Current base directory
 * @param {object} [options={}]
 * @param {string[]} [options.allowedDirs=[]] - Additional allowed directories
 * @param {boolean} [options.mustExist=false] - Whether file must exist
 * @param {boolean} [options.allowTermuxStorage=false] - Auto-allow Termux storage paths (SEC-04: opt-in via config `security.allowTermuxStorage=true`)
 * @returns {{ resolvedPath: string, isInsideBase: boolean, isAllowed: boolean, exists: boolean }}
 */
export function validateSafePath(targetPath, baseDir = process.cwd(), options = {}) {
  if (!targetPath || typeof targetPath !== 'string') {
    throw new Error('Target path must be a non-empty string');
  }

  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(resolvedBase, targetPath);

  const isInsideBase = isPathInside(resolvedBase, resolvedTarget);

  let isAllowed = isInsideBase;
  if (!isAllowed && Array.isArray(options.allowedDirs)) {
    isAllowed = options.allowedDirs.some((dir) => isPathInside(dir, resolvedTarget));
  }

  // SEC-04: Termux storage paths are now opt-in. Default `false` so the
  // agent's safe workspace is the project dir, not the entire SD card.
  // Enable explicitly via `faycli config set security.allowTermuxStorage true`.
  if (!isAllowed && options.allowTermuxStorage === true) {
    if (isTermuxStoragePath(resolvedTarget)) {
      isAllowed = true;
    } else {
      const termuxPaths = getTermuxAllowedStoragePaths();
      if (termuxPaths.some((dir) => isPathInside(dir, resolvedTarget))) {
        isAllowed = true;
      }
    }
  }

  const exists = fs.existsSync(resolvedTarget);
  if (options.mustExist && !exists) {
    throw new Error(`File or directory does not exist: "${resolvedTarget}"`);
  }

  return {
    resolvedPath: resolvedTarget,
    isInsideBase,
    isAllowed,
    exists,
  };
}

/**
 * Determines whether a file is binary or text.
 * Checks extension first, then samples the first 512 bytes for null bytes or control characters.
 *
 * @param {string} filePath
 * @param {Buffer} [bufferSample=null]
 * @returns {boolean}
 */
export function isBinaryFile(filePath, bufferSample = null) {
  const ext = path.extname(filePath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) {
    return true;
  }

  try {
    let sample = bufferSample;
    if (!sample) {
      if (!fs.existsSync(filePath)) {
        return false;
      }
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        return false;
      }
      const fd = fs.openSync(filePath, 'r');
      try {
        const buf = Buffer.alloc(Math.min(512, stat.size));
        const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
        sample = buf.subarray(0, bytesRead);
      } finally {
        fs.closeSync(fd);
      }
    }

    if (!sample || sample.length === 0) {
      return false;
    }

    // Check for null bytes (\0) or non-text control chars (excluding \t, \n, \r, \f)
    for (let i = 0; i < sample.length; i++) {
      const byte = sample[i];
      if (byte === 0) {
        return true;
      }
      // Control characters other than standard whitespace
      if (byte < 7 || (byte > 14 && byte < 32 && byte !== 27)) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}
