/**
 * Thought/Reasoning Display Toggle
 * Toggled via /thoughts slash command.
 * When enabled: strips <think> from stream AND prints content dimmed.
 * When disabled: strips silently (preserving existing behavior).
 */
import { ansi } from '../utils/ansi.js';

const THINK_RE = /<think>([\s\S]*?)<\/think>/gi;

export function extractThoughtBlocks(text) {
  if (typeof text !== 'string') return [];
  const result = [];
  let match;
  THINK_RE.lastIndex = 0;
  while ((match = THINK_RE.exec(text)) !== null) result.push(match[1]);
  return result;
}

export function stripThoughtBlocks(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '');
}

export function createThoughtDisplay({ stream }) {
  let enabled = false;
  return {
    isEnabled() { return enabled; },
    toggle() { enabled = !enabled; return enabled; },
    processToken(token) {
      if (!token) return token;
      if (enabled) {
        for (const thought of extractThoughtBlocks(token)) {
          const trimmed = thought.trim();
          if (trimmed) stream.write(`${ansi.dim(ansi.italic(`\uD83D\uDCAD ${trimmed}`))}\n`);
        }
      }
      return stripThoughtBlocks(token);
    },
  };
}
