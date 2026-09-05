/**
 * REPL Prompt History Indicator
 * Format (turn 0):  fay ❯
 * Format (turn 3):  fay [3] ❯
 */
import { ansi } from '../utils/ansi.js';

export function formatTurnBadge(turn) {
  if (!turn || turn <= 0) return '';
  return ansi.dim(ansi.yellow(`[${turn}]`));
}

export function buildPrompt({ appName, turn = 0 }) {
  const badge = formatTurnBadge(turn);
  const nameStr = ansi.cyan(appName);
  const arrow = ansi.bold('\u276F');
  return badge ? `${nameStr} ${badge} ${arrow} ` : `${nameStr} ${arrow} `;
}
