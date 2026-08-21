/**
 * Tool: patch_file
 * Performs token-efficient exact search-and-replace / diff patching on an existing file.
 */

import fs from 'node:fs';
import path from 'node:path';
import { writeFileTool } from './write_file.js';

/**
 * Patches a file by replacing a unique searchString with replaceString.
 *
 * @param {object} args
 * @param {string} args.filePath - Path to the file
 * @param {string} args.searchString - Exact string to be replaced (must occur exactly once)
 * @param {string} args.replaceString - New string to replace the searchString
 * @param {object} [context={}]
 * @returns {Promise<object>}
 */
export async function patchFileTool(args, context = {}) {
  const { filePath, searchString, replaceString } = args;

  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Missing or invalid "filePath" argument');
  }

  if (typeof searchString !== 'string' || searchString.length === 0) {
    throw new Error('Missing or invalid "searchString" argument (must be a non-empty string)');
  }

  if (typeof replaceString !== 'string') {
    throw new Error('Missing or invalid "replaceString" argument (must be a string)');
  }

  const resolvedPath = path.resolve(context.baseDir || process.cwd(), filePath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File not found for patching: "${filePath}"`);
  }

  const originalContent = fs.readFileSync(resolvedPath, 'utf-8');

  // Count occurrences
  let count = 0;
  let pos = originalContent.indexOf(searchString);
  while (pos !== -1) {
    count++;
    pos = originalContent.indexOf(searchString, pos + searchString.length);
  }

  if (count === 0) {
    throw new Error(
      `Could not patch "${filePath}": searchString was not found.\n` +
      `Ensure that searchString matches the exact character sequence, indentation, and line breaks.`
    );
  }

  if (count > 1) {
    throw new Error(
      `Could not patch "${filePath}": searchString occurs ${count} times in the file.\n` +
      `The searchString must be unique to prevent ambiguous or unintended replacements. Include more surrounding context lines.`
    );
  }

  const updatedContent = originalContent.replace(searchString, replaceString);

  // Write patched file atomically
  await writeFileTool({ filePath, content: updatedContent }, context);

  const originalLines = originalContent.split(/\r?\n/).length;
  const updatedLines = updatedContent.split(/\r?\n/).length;

  return {
    success: true,
    filePath,
    originalLines,
    updatedLines,
    lineDelta: updatedLines - originalLines,
    message: `Successfully patched "${filePath}" (unique match replaced).`
  };
}
