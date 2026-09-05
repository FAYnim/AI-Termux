/**
 * Inline Diff Preview Component
 * LCS-based line diff; zero external dependencies.
 */
import { ansi } from '../utils/ansi.js';

export function buildDiffLines(before, after) {
  const aLines = before.split('\n');
  const bLines = after.split('\n');
  const m = aLines.length;
  const n = bLines.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = aLines[i] === bLines[j]
        ? 1 + dp[i + 1][j + 1]
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const result = [];
  let i = 0; let j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && aLines[i] === bLines[j]) {
      result.push(` ${aLines[i]}`); i++; j++;
    } else if (j < n && (i >= m || dp[i + 1][j] <= dp[i][j + 1])) {
      result.push(`+${bLines[j]}`); j++;
    } else {
      result.push(`-${aLines[i]}`); i++;
    }
  }
  return result;
}

export function renderDiffPreview({ filePath, before, after, maxLines = 40 }) {
  const lines = buildDiffLines(before, after);
  const total = lines.length;
  const visible = lines.slice(0, maxLines);
  const colored = visible.map((line) =>
    line.startsWith('+') ? ansi.green(line)
    : line.startsWith('-') ? ansi.red(line)
    : ansi.dim(line)
  );
  if (total > maxLines) colored.push(ansi.dim(`  \u2026 ${total - maxLines} more lines \u2026`));
  const cols = (typeof process !== 'undefined' && process.stdout?.columns) || 80;
  const rule = ansi.dim('\u2500'.repeat(Math.min(60, cols - 2)));
  const header = `${ansi.bold(ansi.yellow('\uD83D\uDCC4 Diff Preview:'))} ${ansi.cyan(filePath)}`;
  return `\n${header}\n${rule}\n${colored.join('\n')}\n${rule}\n`;
}
