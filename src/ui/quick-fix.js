/**
 * Quick-Fix Suggestion Bar
 * Shown as a compact dim line after each agent turn.
 * Output: "💡 Next: [1] Run tests  [2] Git commit  [3] Show session"
 */
import { ansi } from '../utils/ansi.js';

const RULES = [
  {
    tools: ['write_file', 'patch_file'],
    suggestions: [
      { label: 'Run tests', cmd: 'run the tests and show results' },
      { label: 'Git commit', cmd: 'commit these changes with a meaningful message' },
      { label: 'Show session', cmd: '/session' },
    ],
  },
  {
    tools: ['execute_command'],
    suggestions: [
      { label: 'Check output', cmd: 'summarize the command output briefly' },
      { label: 'Show session', cmd: '/session' },
    ],
  },
  {
    tools: ['git_add_commit'],
    suggestions: [
      { label: 'Git log', cmd: 'show git log --oneline -5' },
      { label: 'Show session', cmd: '/session' },
    ],
  },
  {
    tools: ['web_fetch', 'web_search'],
    suggestions: [{ label: 'Summarize', cmd: 'summarize the fetched content briefly' }],
  },
];

export function deriveQuickFixes({ toolCalls = [], text = '' }) {
  if (!toolCalls || toolCalls.length === 0) return [];
  const usedTools = new Set(toolCalls.map((tc) => tc.name));
  const seen = new Set();
  const suggestions = [];
  for (const rule of RULES) {
    if (rule.tools.some((t) => usedTools.has(t))) {
      for (const s of rule.suggestions) {
        if (!seen.has(s.label)) { seen.add(s.label); suggestions.push(s); }
      }
    }
  }
  return suggestions.slice(0, 4);
}

export function renderQuickFixBar(fixes) {
  if (!fixes || fixes.length === 0) return '';
  const items = fixes
    .map((fix, i) => `${ansi.bold(ansi.cyan(`[${i + 1}]`))} ${ansi.white(fix.label)}`)
    .join('  ');
  return `${ansi.dim('\uD83D\uDCA1 Next:')} ${items}\n`;
}
