/**
 * Terminal Box, Container & Banner UI Components
 * Zero-dependency, lightweight, ANSI-formatted.
 */

import { ansi, stripAnsi } from '../utils/ansi.js';

const BORDER_STYLES = {
  round: {
    tl: '╭',
    tr: '╮',
    bl: '╰',
    br: '╯',
    h: '─',
    v: '│',
  },
  single: {
    tl: '┌',
    tr: '┐',
    bl: '└',
    br: '┘',
    h: '─',
    v: '│',
  },
  double: {
    tl: '╔',
    tr: '╗',
    bl: '╚',
    br: '╝',
    h: '═',
    v: '║',
  },
  bold: {
    tl: '┏',
    tr: '┓',
    bl: '┗',
    br: '┛',
    h: '━',
    v: '┃',
  },
};

/**
 * Creates a formatted terminal box around text
 *
 * @param {string} text - Text content to enclose
 * @param {object} [options={}]
 * @param {string} [options.title=''] - Optional box header title
 * @param {'round'|'single'|'double'|'bold'} [options.borderStyle='round'] - Border style
 * @param {string} [options.borderColor='gray'] - Color function name on ansi (e.g. 'cyan', 'green', 'yellow')
 * @param {number} [options.padding=1] - Internal padding spaces
 * @param {number} [options.minWidth=30] - Minimum width of the box
 * @returns {string} Formatted box string
 */
export function renderBox(text, options = {}) {
  const content = text || '';
  const lines = content.split('\n');
  const title = options.title || '';
  const titleClean = stripAnsi(title);
  const borderType = BORDER_STYLES[options.borderStyle] || BORDER_STYLES.round;
  const colorName = options.borderColor || 'gray';
  const colorFn = typeof ansi[colorName] === 'function' ? ansi[colorName] : ansi.gray;
  const padding = options.padding !== undefined ? options.padding : 1;
  const minWidth = options.minWidth || 30;

  const contentMaxLen = lines.reduce((max, l) => Math.max(max, stripAnsi(l).length), 0);
  const titleLen = titleClean ? titleClean.length + 4 : 0;
  const innerWidth = Math.max(contentMaxLen, titleLen, minWidth);

  // Top border with optional title
  let topBorder;
  if (titleClean) {
    const rem = Math.max(0, innerWidth - titleClean.length - 2);
    topBorder = `${borderType.tl}${borderType.h} ${ansi.bold(title)} ${borderType.h.repeat(rem)}${borderType.tr}`;
  } else {
    topBorder = `${borderType.tl}${borderType.h.repeat(innerWidth + padding * 2)}${borderType.tr}`;
  }

  const bottomBorder = `${borderType.bl}${borderType.h.repeat(innerWidth + padding * 2)}${borderType.br}`;
  const padStr = ' '.repeat(padding);

  const output = [];
  output.push(colorFn(topBorder));

  for (const line of lines) {
    const cleanLen = stripAnsi(line).length;
    const rightPad = ' '.repeat(Math.max(0, innerWidth - cleanLen));
    output.push(
      `${colorFn(borderType.v)}${padStr}${line}${rightPad}${padStr}${colorFn(borderType.v)}`,
    );
  }

  output.push(colorFn(bottomBorder));
  return output.join('\n');
}

/**
 * Renders an attractive startup banner for CLI / REPL
 *
 * @param {object} [options={}]
 * @param {string} [options.title='⚡ termux-ai-cli']
 * @param {string} [options.version='v1.0.0']
 * @param {string} [options.subtitle='Autonomous AI Agent CLI for Termux']
 * @param {Array<string>} [options.details=[]]
 * @returns {string}
 */
export function renderBanner(options = {}) {
  const title = options.title || '⚡ termux-ai-cli';
  const version = options.version || 'v1.0.0';
  const subtitle = options.subtitle || 'Autonomous AI Agent CLI for Termux Android';
  const details = options.details || [];

  const lines = [
    `${ansi.bold(ansi.cyanBright(title))} ${ansi.dim(version)}`,
    `${ansi.white(subtitle)}`,
  ];

  if (details.length > 0) {
    lines.push('');
    for (const detail of details) {
      lines.push(`${ansi.yellow('•')} ${detail}`);
    }
  }

  return renderBox(lines.join('\n'), {
    borderStyle: 'round',
    borderColor: 'cyan',
    padding: 1,
    minWidth: 46,
  });
}

/**
 * Renders a key-value status card
 *
 * @param {string} title
 * @param {Record<string, any>} data
 * @param {object} [options={}]
 * @returns {string}
 */
export function renderStatusCard(title, data = {}, options = {}) {
  const entries = Object.entries(data);
  if (entries.length === 0) {
    return renderBox(ansi.dim('(Empty)'), { title, ...options });
  }

  const maxKeyLen = entries.reduce((max, [k]) => Math.max(max, k.length), 0);
  const lines = entries.map(([k, v]) => {
    const pad = ' '.repeat(Math.max(0, maxKeyLen - k.length));
    const valStr = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
    return `${ansi.cyan(k)}${pad} ${ansi.dim('→')} ${ansi.whiteBright(valStr)}`;
  });

  return renderBox(lines.join('\n'), {
    title,
    borderStyle: 'round',
    borderColor: 'yellow',
    ...options,
  });
}
