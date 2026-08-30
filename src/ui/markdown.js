/**
 * Zero-dependency ANSI Markdown & Code Syntax Highlighter
 * Optimized for lightweight execution in Termux Android terminal environments.
 */

import { ansi, stripAnsi } from '../utils/ansi.js';

// Keywords dictionary for syntax highlighting
const KEYWORDS = {
  javascript: new Set([
    'const',
    'let',
    'var',
    'function',
    'class',
    'import',
    'export',
    'from',
    'default',
    'return',
    'if',
    'else',
    'switch',
    'case',
    'break',
    'continue',
    'for',
    'while',
    'do',
    'try',
    'catch',
    'finally',
    'throw',
    'new',
    'this',
    'async',
    'await',
    'yield',
    'typeof',
    'instanceof',
    'void',
    'delete',
    'in',
    'of',
    'null',
    'undefined',
    'true',
    'false',
    'extends',
    'super',
    'static',
    'get',
    'set',
  ]),
  python: new Set([
    'def',
    'class',
    'import',
    'from',
    'as',
    'return',
    'if',
    'elif',
    'else',
    'for',
    'while',
    'break',
    'continue',
    'try',
    'except',
    'finally',
    'raise',
    'with',
    'pass',
    'lambda',
    'global',
    'nonlocal',
    'assert',
    'yield',
    'self',
    'cls',
    'True',
    'False',
    'None',
    'and',
    'or',
    'not',
    'in',
    'is',
    'async',
    'await',
  ]),
  bash: new Set([
    'if',
    'then',
    'else',
    'elif',
    'fi',
    'for',
    'in',
    'do',
    'done',
    'while',
    'until',
    'case',
    'esac',
    'function',
    'return',
    'exit',
    'source',
    'alias',
    'export',
    'unset',
    'local',
    'readonly',
    'shift',
    'set',
    'echo',
    'printf',
    'read',
    'cd',
    'pwd',
    'ls',
    'mkdir',
    'rm',
    'cp',
    'mv',
    'cat',
    'grep',
    'sed',
    'awk',
    'chmod',
    'chown',
    'curl',
    'wget',
    'git',
    'npm',
    'node',
    'pkg',
    'apt',
    'su',
    'sudo',
    'tar',
    'find',
  ]),
  sql: new Set([
    'select',
    'from',
    'where',
    'insert',
    'into',
    'values',
    'update',
    'set',
    'delete',
    'create',
    'table',
    'drop',
    'alter',
    'join',
    'inner',
    'left',
    'right',
    'full',
    'outer',
    'cross',
    'on',
    'group',
    'by',
    'order',
    'having',
    'limit',
    'offset',
    'and',
    'or',
    'not',
    'in',
    'is',
    'null',
    'like',
    'as',
    'distinct',
    'union',
    'all',
    'primary',
    'key',
    'foreign',
    'references',
    'index',
    'view',
    'trigger',
    'begin',
    'commit',
    'rollback',
    'transaction',
    'count',
    'sum',
    'avg',
    'min',
    'max',
    'asc',
    'desc',
  ]),
};

const BUILTINS = {
  javascript: new Set([
    'console',
    'process',
    'Math',
    'JSON',
    'Promise',
    'Array',
    'Object',
    'String',
    'Number',
    'Boolean',
    'Date',
    'RegExp',
    'Map',
    'Set',
    'Error',
    'Buffer',
  ]),
  python: new Set([
    'print',
    'len',
    'range',
    'str',
    'int',
    'float',
    'list',
    'dict',
    'set',
    'tuple',
    'open',
    'type',
    'enumerate',
    'zip',
    'map',
    'filter',
    'sum',
    'min',
    'max',
  ]),
};

/**
 * Highlights a block of code using ANSI terminal escape sequences.
 *
 * @param {string} code - Raw code string
 * @param {string} [language=''] - Language identifier (e.g. 'js', 'py', 'sh', 'json', 'sql', 'html')
 * @returns {string} - Highlighted ANSI formatted code
 */
export function highlightCode(code, language = '') {
  if (!code || typeof code !== 'string') return '';

  const lang = (language || '').toLowerCase().trim();

  // Normalize language aliases
  let canonicalLang = 'text';
  if (['javascript', 'js', 'mjs', 'cjs', 'jsx', 'typescript', 'ts', 'tsx'].includes(lang)) {
    canonicalLang = 'javascript';
  } else if (['python', 'py'].includes(lang)) {
    canonicalLang = 'python';
  } else if (['bash', 'sh', 'shell', 'zsh'].includes(lang)) {
    canonicalLang = 'bash';
  } else if (['json', 'jsonc'].includes(lang)) {
    canonicalLang = 'json';
  } else if (['sql'].includes(lang)) {
    canonicalLang = 'sql';
  } else if (['html', 'xml', 'svg'].includes(lang)) {
    canonicalLang = 'html';
  } else if (['css', 'scss', 'sass', 'less'].includes(lang)) {
    canonicalLang = 'css';
  }

  const lines = code.split('\n');
  const highlightedLines = lines.map((line) => highlightLine(line, canonicalLang));

  return highlightedLines.join('\n');
}

/**
 * Highlights a single line of code
 *
 * @param {string} line
 * @param {string} lang
 * @returns {string}
 */
function highlightLine(line, lang) {
  if (!line) return '';

  if (lang === 'text') {
    return ansi.white(line);
  }

  if (lang === 'json') {
    return highlightJsonLine(line);
  }

  if (lang === 'html') {
    return highlightHtmlLine(line);
  }

  // Tokenize line for programming languages (JS, Python, Bash, SQL, CSS)
  // Regex to match: comments, strings, numbers, bash variables, identifiers/words, symbols
  const tokenRegex =
    /(".*?"|'.*?'|`.*?`|\/\/.*$|\/\*.*?\*\/|#.*$|--.*$|\$[a-zA-Z0-9_]+|\${[a-zA-Z0-9_]+}|0x[0-9a-fA-F]+|\b\d+(?:\.\d+)?\b|[a-zA-Z_][a-zA-Z0-9_]*|[^\s\w])/g;

  return line.replace(tokenRegex, (match) => {
    // Comment
    if (
      match.startsWith('//') ||
      match.startsWith('/*') ||
      (lang === 'python' && match.startsWith('#')) ||
      (lang === 'bash' && match.startsWith('#')) ||
      (lang === 'sql' && match.startsWith('--'))
    ) {
      return ansi.gray(ansi.italic(match));
    }

    // Strings
    if (
      (match.startsWith('"') && match.endsWith('"')) ||
      (match.startsWith("'") && match.endsWith("'")) ||
      (match.startsWith('`') && match.endsWith('`'))
    ) {
      return ansi.green(match);
    }

    // Bash Variables ($VAR or ${VAR})
    if (lang === 'bash' && (match.startsWith('$') || match.startsWith('${'))) {
      return ansi.magentaBright(match);
    }

    // Numbers
    if (/^(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?)$/.test(match)) {
      return ansi.yellow(match);
    }

    // Keywords
    const lowerMatch = match.toLowerCase();
    const keywords = KEYWORDS[lang];
    if (keywords) {
      if (keywords.has(lang === 'sql' ? lowerMatch : match)) {
        return ansi.magenta(ansi.bold(match));
      }
    }

    // Builtins
    const builtins = BUILTINS[lang];
    if (builtins?.has(match)) {
      return ansi.cyan(match);
    }

    // Functions (word followed by open parenthesis in context is handled broadly here)
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(match)) {
      return ansi.white(match);
    }

    // Operators and delimiters
    if ('+-*/%=<>!&|^~?:;,{}[]().'.includes(match)) {
      return ansi.cyan(match);
    }

    return match;
  });
}

/**
 * Highlights a JSON line
 * @param {string} line
 * @returns {string}
 */
function highlightJsonLine(line) {
  return line.replace(
    /("(?:\\.|[^"\\])*")(?:\s*(:))?|(\b(?:true|false|null)\b)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],])/g,
    (match, str, colon, boolNull, num, punctuation) => {
      if (str && colon) {
        // Key
        return `${ansi.cyanBright(str)}${ansi.white(':')}`;
      }
      if (str) {
        // String value
        return ansi.green(str);
      }
      if (boolNull) {
        // Boolean or null
        return ansi.magenta(ansi.bold(boolNull));
      }
      if (num) {
        // Number
        return ansi.yellow(num);
      }
      if (punctuation) {
        return ansi.white(punctuation);
      }
      return match;
    },
  );
}

/**
 * Highlights an HTML/XML line
 * @param {string} line
 * @returns {string}
 */
function highlightHtmlLine(line) {
  return line.replace(
    /(<!--.*?-->)|(<\/?)([a-zA-Z0-9\-:]+)([^>]*?)(\/?>)|(".*?"|'.*?')/g,
    (match, comment, openBracket, tagName, attrs, closeBracket, str) => {
      if (comment) {
        return ansi.gray(ansi.italic(comment));
      }
      if (str) {
        return ansi.green(str);
      }
      if (openBracket && tagName) {
        const highlightedAttrs = (attrs || '').replace(
          /([a-zA-Z0-9\-:]+)(?:(=)(".*?"|'.*?'|[^\s>]+))?/g,
          (_, attrName, eq, attrVal) => {
            let res = ansi.yellow(attrName);
            if (eq) {
              res += ansi.white('=') + (attrVal ? ansi.green(attrVal) : '');
            }
            return res;
          },
        );
        return `${ansi.cyan(openBracket)}${ansi.redBright(tagName)}${highlightedAttrs}${ansi.cyan(closeBracket)}`;
      }
      return match;
    },
  );
}

/**
 * Parses and renders Markdown tables as clean Unicode bordered terminal tables
 *
 * @param {string} tableMarkdown
 * @returns {string}
 */
export function renderTable(tableMarkdown) {
  if (!tableMarkdown || typeof tableMarkdown !== 'string') return '';

  const lines = tableMarkdown
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|') || l.includes('|'));

  if (lines.length === 0) return '';

  // Extract raw rows
  const parsedRows = lines.map((line) => {
    const trimmed = line.replace(/^\|/, '').replace(/\|$/, '');
    return trimmed.split('|').map((cell) => cell.trim());
  });

  if (parsedRows.length === 0) return '';

  // Check if second row is separator (|---|---|)
  let hasSeparator = false;
  let separatorIndex = -1;
  for (let i = 0; i < parsedRows.length; i++) {
    const isSep = parsedRows[i].every((cell) => /^:?-+:?$/.test(cell));
    if (isSep) {
      hasSeparator = true;
      separatorIndex = i;
      break;
    }
  }

  const contentRows = parsedRows.filter((_, idx) => idx !== separatorIndex);
  if (contentRows.length === 0) return '';

  // Calculate column count and column max widths
  const numCols = Math.max(...contentRows.map((row) => row.length));
  const colWidths = new Array(numCols).fill(0);

  for (const row of contentRows) {
    for (let c = 0; c < numCols; c++) {
      const cellText = row[c] || '';
      const len = stripAnsi(renderInline(cellText)).length;
      if (len > colWidths[c]) {
        colWidths[c] = len;
      }
    }
  }

  // Ensure minimum column width
  for (let c = 0; c < numCols; c++) {
    colWidths[c] = Math.max(colWidths[c], 3);
  }

  const buildBorder = (left, mid, right, fill) => {
    const parts = colWidths.map((w) => fill.repeat(w + 2));
    return `${left}${parts.join(mid)}${right}`;
  };

  const topBorder = ansi.gray(buildBorder('┌', '┬', '┐', '─'));
  const midBorder = ansi.gray(buildBorder('├', '┼', '┤', '─'));
  const botBorder = ansi.gray(buildBorder('└', '┴', '┘', '─'));

  const renderRow = (row, isHeader = false) => {
    const cells = [];
    for (let c = 0; c < numCols; c++) {
      const cellRaw = row[c] || '';
      const formatted = isHeader
        ? ansi.bold(ansi.cyan(renderInline(cellRaw)))
        : renderInline(cellRaw);
      const cleanLen = stripAnsi(formatted).length;
      const pad = ' '.repeat(Math.max(0, colWidths[c] - cleanLen));
      cells.push(` ${formatted}${pad} `);
    }
    return `${ansi.gray('│')}${cells.join(ansi.gray('│'))}${ansi.gray('│')}`;
  };

  const output = [];
  output.push(topBorder);

  if (hasSeparator && contentRows.length > 0) {
    // First row is header
    output.push(renderRow(contentRows[0], true));
    output.push(midBorder);
    for (let r = 1; r < contentRows.length; r++) {
      output.push(renderRow(contentRows[r], false));
    }
  } else {
    for (let r = 0; r < contentRows.length; r++) {
      output.push(renderRow(contentRows[r], false));
      if (r < contentRows.length - 1) {
        output.push(midBorder);
      }
    }
  }

  output.push(botBorder);
  return output.join('\n');
}

/**
 * Renders inline Markdown formatting (bold, italic, strikethrough, inline code, links)
 *
 * @param {string} text
 * @returns {string}
 */
export function renderInline(text) {
  if (!text || typeof text !== 'string') return '';

  let out = text;

  // Inline Code: `code`
  out = out.replace(/`([^`]+)`/g, (_, code) => {
    return ansi.cyan(ansi.bold(code));
  });

  // Bold + Italic: ***text*** or ___text___
  out = out.replace(/(\*\*\*|___)(.*?)\1/g, (_, __, content) => {
    return ansi.bold(ansi.italic(content));
  });

  // Bold: **text** or __text__
  out = out.replace(/(\*\*|__)(.*?)\1/g, (_, __, content) => {
    return ansi.bold(content);
  });

  // Italic: *text* or _text_
  out = out.replace(/(\*|_)(.*?)\1/g, (_, __, content) => {
    return ansi.italic(content);
  });

  // Strikethrough: ~~text~~
  out = out.replace(/~~(.*?)~~/g, (_, content) => {
    return ansi.strikethrough(content);
  });

  // Links: [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    return `${ansi.bold(label)} (${ansi.cyan(ansi.underline(url))})`;
  });

  return out;
}

/**
 * Renders full markdown text with ANSI styling
 *
 * @param {string} markdown - Markdown input string
 * @param {object} [options={}]
 * @returns {string} ANSI formatted string
 */
export function renderMarkdown(markdown, _options = {}) {
  if (!markdown || typeof markdown !== 'string') return '';

  const lines = markdown.split('\n');
  const result = [];
  let inCodeBlock = false;
  let codeLang = '';
  let codeBuffer = [];
  let inTable = false;
  let tableBuffer = [];

  const flushTable = () => {
    if (tableBuffer.length > 0) {
      result.push(renderTable(tableBuffer.join('\n')));
      tableBuffer = [];
      inTable = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check code block fences (``` or ~~~)
    const codeFenceMatch = line.match(/^```(\w*)/);
    if (codeFenceMatch) {
      flushTable();
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLang = codeFenceMatch[1] || '';
        codeBuffer = [];
      } else {
        // Close code block
        inCodeBlock = false;
        const langTag = codeLang ? ` [${codeLang}] ` : '';
        const header = ansi.gray(
          `───${ansi.cyan(langTag)}${'─'.repeat(Math.max(0, 40 - langTag.length))}`,
        );
        const footer = ansi.gray('─'.repeat(43));
        const highlighted = highlightCode(codeBuffer.join('\n'), codeLang);

        result.push(header);
        result.push(highlighted);
        result.push(footer);
        codeBuffer = [];
        codeLang = '';
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    // Check table row
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 1) {
      inTable = true;
      tableBuffer.push(trimmed);
      continue;
    } else if (inTable) {
      flushTable();
    }

    // Headers
    if (/^#\s+(.+)$/.test(line)) {
      const title = line.replace(/^#\s+/, '');
      result.push('');
      result.push(`${ansi.bold(ansi.cyanBright(`█ ${title}`))}`);
      result.push(ansi.cyan('━'.repeat(Math.min(60, Math.max(10, stripAnsi(title).length + 2)))));
      continue;
    }

    if (/^##\s+(.+)$/.test(line)) {
      const title = line.replace(/^##\s+/, '');
      result.push('');
      result.push(`${ansi.bold(ansi.yellowBright(`## ${title}`))}`);
      continue;
    }

    if (/^###\s+(.+)$/.test(line)) {
      const title = line.replace(/^###\s+/, '');
      result.push('');
      result.push(`${ansi.bold(ansi.whiteBright(`### ${title}`))}`);
      continue;
    }

    if (/^####+\s+(.+)$/.test(line)) {
      const title = line.replace(/^####+\s+/, '');
      result.push(`${ansi.bold(ansi.dim(`▸ ${title}`))}`);
      continue;
    }

    // Horizontal Rule
    if (/^(\*{3,}|-{3,}|_{3,})$/.test(trimmed)) {
      result.push(ansi.gray('─'.repeat(50)));
      continue;
    }

    // Blockquote
    if (/^>\s?(.*)$/.test(line)) {
      const content = line.replace(/^>\s?/, '');
      result.push(`${ansi.cyan('│')} ${ansi.gray(ansi.italic(renderInline(content)))}`);
      continue;
    }

    // Unordered List (- item, * item, + item)
    if (/^(\s*)[-*+]\s+(.+)$/.test(line)) {
      const match = line.match(/^(\s*)[-*+]\s+(.+)$/);
      const indent = match[1] || '';
      const content = match[2];
      const bullet = indent.length >= 2 ? ansi.yellow('▪') : ansi.cyan('•');
      result.push(`${indent}${bullet} ${renderInline(content)}`);
      continue;
    }

    // Ordered List (1. item)
    if (/^(\s*)(\d+)\.\s+(.+)$/.test(line)) {
      const match = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
      const indent = match[1] || '';
      const num = match[2];
      const content = match[3];
      result.push(`${indent}${ansi.yellow(`${num}.`)} ${renderInline(content)}`);
      continue;
    }

    // Normal paragraph text
    result.push(renderInline(line));
  }

  // Flush any lingering code or table buffer
  if (inCodeBlock && codeBuffer.length > 0) {
    result.push(highlightCode(codeBuffer.join('\n'), codeLang));
  }
  flushTable();

  return result.join('\n');
}
