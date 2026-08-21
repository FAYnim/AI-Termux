/**
 * Termux & Android Environment Detection Utilities
 * Provides helpers for detecting Termux-specific paths and storage layouts.
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Termux standard environment markers
const TERMUX_PREFIX = '/data/data/com.termux/files/usr';
const TERMUX_HOME = '/data/data/com.termux/files/home';
const TERMUX_STORAGE_HOME = '/sdcard'; // requires termux-setup-storage
const TERMUX_SHARED_STORAGE = `${TERMUX_HOME}/storage/shared`;

/**
 * Detect whether the current process is running inside a Termux environment.
 * Checks $PREFIX environment variable and the presence of the Termux usr prefix.
 *
 * @returns {boolean}
 */
export function isTermux() {
  // Termux sets $PREFIX to its usr directory
  if (process.env.PREFIX === TERMUX_PREFIX) {
    return true;
  }
  // Secondary check: TERMUX_VERSION is sometimes exported
  if (process.env.TERMUX_VERSION) {
    return true;
  }
  // Filesystem marker: Termux prefix directory exists
  try {
    if (fs.existsSync(TERMUX_PREFIX)) {
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

/**
 * Get the standard Termux home directory.
 * Falls back to os.homedir() if not running in Termux.
 *
 * @returns {string}
 */
export function getTermuxHome() {
  if (isTermux()) {
    return TERMUX_HOME;
  }
  return os.homedir() || process.env.HOME || TERMUX_HOME;
}

/**
 * Get Termux usr/prefix path.
 * Returns null if not running in Termux.
 *
 * @returns {string|null}
 */
export function getTermuxPrefix() {
  return process.env.PREFIX || (isTermux() ? TERMUX_PREFIX : null);
}

/**
 * Resolve the t-ai configuration root directory.
 * On Termux: `~/.t-ai` under Termux home.
 * On other platforms: `~/.t-ai` under os.homedir().
 *
 * @returns {string}
 */
export function getConfigRoot() {
  const home = getTermuxHome();
  return path.join(home, '.t-ai');
}

/**
 * Get a list of allowed storage directories for the current platform.
 * On Termux: includes /sdcard and ~/storage/shared if setup-storage was run.
 * On other platforms: returns empty list.
 *
 * @returns {string[]}
 */
export function getTermuxAllowedStoragePaths() {
  if (!isTermux()) {
    return [];
  }

  const allowed = [];

  // External SD card / shared internal storage (requires termux-setup-storage)
  if (fs.existsSync(TERMUX_STORAGE_HOME)) {
    allowed.push(TERMUX_STORAGE_HOME);
  }

  if (fs.existsSync(TERMUX_SHARED_STORAGE)) {
    allowed.push(TERMUX_SHARED_STORAGE);
  }

  // Also include common storage symlink paths inside Termux home
  const storageDir = path.join(getTermuxHome(), 'storage');
  if (fs.existsSync(storageDir)) {
    try {
      const entries = fs.readdirSync(storageDir);
      for (const entry of entries) {
        const full = path.join(storageDir, entry);
        try {
          const stat = fs.lstatSync(full);
          if (stat.isDirectory() || stat.isSymbolicLink()) {
            allowed.push(full);
          }
        } catch {
          // skip unreadable entries
        }
      }
    } catch {
      // skip if storage dir is unreadable
    }
  }

  return [...new Set(allowed)];
}

/**
 * Returns a concise environment info object for diagnostics.
 *
 * @returns {{
 *   isTermux: boolean,
 *   termuxHome: string,
 *   termuxPrefix: string|null,
 *   configRoot: string,
 *   allowedStoragePaths: string[],
 *   platform: string,
 *   arch: string,
 *   nodeVersion: string
 * }}
 */
export function getEnvironmentInfo() {
  return {
    isTermux: isTermux(),
    termuxHome: getTermuxHome(),
    termuxPrefix: getTermuxPrefix(),
    configRoot: getConfigRoot(),
    allowedStoragePaths: getTermuxAllowedStoragePaths(),
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version
  };
}

/**
 * Checks if a given path is a Termux external storage path.
 *
 * @param {string} targetPath
 * @returns {boolean}
 */
export function isTermuxStoragePath(targetPath) {
  if (!isTermux() || !targetPath) return false;

  const resolved = path.resolve(targetPath);
  const allowed = getTermuxAllowedStoragePaths();

  return allowed.some((dir) => {
    try {
      const rel = path.relative(path.resolve(dir), resolved);
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    } catch {
      return false;
    }
  });
}
