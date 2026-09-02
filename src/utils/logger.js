/**
 * Leveled Console Logger for FAY CLI
 * Zero-dependency, lightweight, ANSI-formatted
 */

/**
 * Logger interface used across the codebase. Every module accepts a logger
 * via options (defaulting to the shared `logger` singleton here).
 * @typedef {Object} Logger
 * @property {(message: string, ...args: unknown[]) => void} info
 * @property {(message: string, ...args: unknown[]) => void} success
 * @property {(message: string, ...args: unknown[]) => void} warn
 * @property {(message: string, ...args: unknown[]) => void} error
 * @property {(message: string, ...args: unknown[]) => void} agent
 * @property {(message: string, ...args: unknown[]) => void} step
 * @property {(message: string, ...args: unknown[]) => void} debug
 * @property {(message: string, ...args: unknown[]) => void} raw
 * @property {(text: string, title?: string) => void} box
 * @property {(enabled: boolean) => void} setVerbose
 * @property {() => boolean} isVerbose
 */

import { ansi, stripAnsi } from './ansi.js';

let verboseMode = false;

export function setVerbose(enabled) {
  verboseMode = Boolean(enabled);
}

export function isVerbose() {
  return verboseMode;
}

export const logger = {
  setVerbose,
  isVerbose,

  info(...args) {
    const prefix = ansi.cyan(ansi.bold('ℹ [INFO]'));
    console.log(prefix, ...args);
  },

  success(...args) {
    const prefix = ansi.green(ansi.bold('✔ [SUCCESS]'));
    console.log(prefix, ...args);
  },

  warn(...args) {
    const prefix = ansi.yellow(ansi.bold('⚠ [WARN]'));
    console.warn(prefix, ...args);
  },

  error(...args) {
    const prefix = ansi.red(ansi.bold('✖ [ERROR]'));
    console.error(prefix, ...args);
  },

  agent(...args) {
    const prefix = ansi.magenta(ansi.bold('⚡ [AGENT]'));
    console.log(prefix, ...args);
  },

  step(...args) {
    const prefix = ansi.blueBright(ansi.bold('➜ [STEP]'));
    console.log(prefix, ...args);
  },

  debug(...args) {
    if (!verboseMode) return;
    const prefix = ansi.gray(ansi.bold('⚙ [DEBUG]'));
    console.log(prefix, ...args);
  },

  raw(...args) {
    console.log(...args);
  },

  box(text, title = '') {
    const lines = text.split('\n');
    const titleClean = stripAnsi(title);
    const maxLineLen = Math.max(
      ...lines.map((l) => stripAnsi(l).length),
      titleClean ? titleClean.length + 4 : 0,
      30,
    );

    const topBorder = titleClean
      ? `┌─ ${ansi.bold(title)} ${'─'.repeat(Math.max(0, maxLineLen - titleClean.length - 4))}┐`
      : `┌${'─'.repeat(maxLineLen + 2)}┐`;
    const bottomBorder = `└${'─'.repeat(maxLineLen + 2)}┘`;

    console.log(ansi.gray(topBorder));
    for (const line of lines) {
      const cleanLen = stripAnsi(line).length;
      const pad = ' '.repeat(Math.max(0, maxLineLen - cleanLen));
      console.log(`${ansi.gray('│')} ${line}${pad} ${ansi.gray('│')}`);
    }
    console.log(ansi.gray(bottomBorder));
  },
};
