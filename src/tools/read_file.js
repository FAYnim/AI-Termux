/**
 * Tool: read_file
 * Reads text content from a file with line-range slicing, size limit, and binary detection.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { isBinaryFile } from '../security/path-validator.js';
import { DEFAULT_SECURITY_CONFIG } from '../security/rules.js';

/**
 * Reads a file safely with token protection and line range slicing.
 *
 * @param {object} args
 * @param {string} args.filePath - Path to the file
 * @param {number} [args.startLine] - 1-indexed starting line number
 * @param {number} [args.endLine] - 1-indexed ending line number
 * @param {string} [args.encoding='utf-8'] - File encoding
 * @param {object} [context={}]
 * @returns {Promise<object>}
 */
export async function readFileTool(args, context = {}) {
  const { filePath, startLine, endLine, encoding = 'utf-8' } = args;

  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Missing or invalid "filePath" argument');
  }

  const resolvedPath = path.resolve(context.baseDir || process.cwd(), filePath);

  // BUG-04: async I/O — never blocks the event loop on large files/dirs
  let stats;
  try {
    stats = await fsp.stat(resolvedPath);
  } catch {
    throw new Error(`File not found: "${filePath}"`);
  }
  if (stats.isDirectory()) {
    throw new Error(`Path is a directory, not a file: "${filePath}". Use "list_dir" instead.`);
  }

  // Sample first 512 bytes for binary detection without sync I/O
  const sample = Buffer.alloc(Math.min(512, stats.size));
  let sampleLen = 0;
  if (sample.length > 0) {
    const fh = await fsp.open(resolvedPath, 'r');
    try {
      ({ bytesRead: sampleLen } = await fh.read(sample, 0, sample.length, 0));
    } finally {
      await fh.close();
    }
  }

  // Detect binary file
  if (isBinaryFile(resolvedPath, sample.subarray(0, sampleLen))) {
    return {
      filePath,
      isBinary: true,
      sizeBytes: stats.size,
      message: `Binary file detected (${stats.size} bytes). Cannot display as text content.`
    };
  }

  const maxBytes = context.maxReadSizeBytes || DEFAULT_SECURITY_CONFIG.maxReadSizeBytes;
  const maxLines = context.maxReadLines || DEFAULT_SECURITY_CONFIG.maxReadLines;

  const rawContent = await fsp.readFile(resolvedPath, { encoding: encoding || 'utf-8' });
  const allLines = rawContent.split(/\r?\n/);
  const totalLines = allLines.length;

  let start = typeof startLine === 'number' && startLine > 0 ? Math.floor(startLine) : 1;
  let end = typeof endLine === 'number' && endLine > 0 ? Math.floor(endLine) : totalLines;

  if (start > totalLines) {
    return {
      filePath,
      content: '',
      totalLines,
      startLine: start,
      endLine: end,
      truncated: false,
      sizeBytes: stats.size
    };
  }

  if (end < start) {
    end = start;
  }

  let selectedLines = allLines.slice(start - 1, end);
  let truncated = false;

  if (selectedLines.length > maxLines) {
    selectedLines = selectedLines.slice(0, maxLines);
    truncated = true;
  }

  let content = selectedLines.join('\n');

  if (Buffer.byteLength(content, 'utf-8') > maxBytes) {
    content = content.slice(0, maxBytes) + '\n... [Output truncated: maximum read size exceeded]';
    truncated = true;
  }

  return {
    filePath,
    content,
    totalLines,
    startLine: start,
    endLine: Math.min(end, start + selectedLines.length - 1),
    truncated,
    sizeBytes: stats.size
  };
}
