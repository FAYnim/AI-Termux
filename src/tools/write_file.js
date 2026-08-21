/**
 * Tool: write_file
 * Writes text content to a destination file using atomic safe write & auto directory creation.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Safely writes content to a file with directory creation and atomic replacement.
 *
 * @param {object} args
 * @param {string} args.filePath - Path to the file
 * @param {string} args.content - Content to write
 * @param {string} [args.encoding='utf-8'] - File encoding
 * @param {object} [context={}]
 * @returns {Promise<object>}
 */
export async function writeFileTool(args, context = {}) {
  const { filePath, content, encoding = 'utf-8' } = args;

  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Missing or invalid "filePath" argument');
  }

  if (typeof content !== 'string') {
    throw new Error('Missing or invalid "content" argument (must be a string)');
  }

  const resolvedPath = path.resolve(context.baseDir || process.cwd(), filePath);
  const parentDir = path.dirname(resolvedPath);

  let createdDirs = false;
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
    createdDirs = true;
  }

  // Atomic write via temp file in the same directory
  const tempPath = `${resolvedPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;

  try {
    fs.writeFileSync(tempPath, content, { encoding: encoding || 'utf-8' });
    fs.renameSync(tempPath, resolvedPath);
  } catch (err) {
    // Fallback if atomic rename fails on certain filesystems
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      // ignore cleanup error
    }
    fs.writeFileSync(resolvedPath, content, { encoding: encoding || 'utf-8' });
  }

  const bytesWritten = Buffer.byteLength(content, encoding || 'utf-8');

  return {
    success: true,
    filePath,
    bytesWritten,
    createdDirs,
    message: `Successfully wrote ${bytesWritten} bytes to "${filePath}".`
  };
}
