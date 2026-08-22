/**
 * Step 5 Test Suite: Markdown Renderer, Code Syntax Highlighter, Spinner & Box UI
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderMarkdown,
  highlightCode,
  renderTable,
  renderInline,
  createSpinner,
  renderBox,
  renderBanner,
  renderStatusCard,
  stripAnsi,
  setColorEnabled
} from '../src/index.js';
import { REPL_PROMPT } from '../src/cli/repl.js';
import { APP_NAME } from '../src/config/constants.js';
import { PassThrough } from 'node:stream';

describe('Step 5: ANSI Markdown & Syntax Highlighter', () => {
  beforeEach(() => {
    setColorEnabled(true);
  });

  test('should render headers with distinct styling', () => {
    setColorEnabled(true);
    const md = '# Main Header\n## Second Header\n### Third Header\n#### Fourth Header';
    const rendered = renderMarkdown(md);
    const plain = stripAnsi(rendered);

    assert.ok(plain.includes('Main Header'));
    assert.ok(plain.includes('Second Header'));
    assert.ok(plain.includes('Third Header'));
    assert.ok(plain.includes('Fourth Header'));
    assert.ok(rendered.includes('\x1b[')); // Has ANSI escape codes
  });

  test('should render inline formatting (bold, italic, strikethrough, inline code, links)', () => {
    setColorEnabled(true);
    const text = 'This is **bold**, *italic*, ~~strikethrough~~, `const x = 10;`, and [Google](https://google.com)';
    const rendered = renderInline(text);
    const plain = stripAnsi(rendered);

    assert.ok(plain.includes('bold'));
    assert.ok(plain.includes('italic'));
    assert.ok(plain.includes('strikethrough'));
    assert.ok(plain.includes('const x = 10;'));
    assert.ok(plain.includes('Google (https://google.com)'));
    assert.ok(rendered.includes('\x1b['));
  });

  test('should render unordered and ordered lists with neat indentation', () => {
    setColorEnabled(true);
    const md = '- Item 1\n- Item 2\n  - Sub Item\n1. First\n2. Second';
    const rendered = renderMarkdown(md);
    const plain = stripAnsi(rendered);

    assert.ok(plain.includes('• Item 1'));
    assert.ok(plain.includes('• Item 2'));
    assert.ok(plain.includes('1. First'));
    assert.ok(plain.includes('2. Second'));
  });

  test('should render blockquotes with vertical bar', () => {
    setColorEnabled(true);
    const md = '> This is a critical advisory.';
    const rendered = renderMarkdown(md);
    const plain = stripAnsi(rendered);

    assert.ok(plain.includes('│'));
    assert.ok(plain.includes('This is a critical advisory.'));
  });

  test('should highlight JavaScript / TypeScript code blocks', () => {
    setColorEnabled(true);
    const code = 'const sum = (a, b) => {\n  // Calculate sum\n  return a + b;\n};';
    const highlighted = highlightCode(code, 'javascript');
    const plain = stripAnsi(highlighted);

    assert.strictEqual(plain, code);
    assert.ok(highlighted.includes('\x1b[')); // ANSI codes attached
  });

  test('should highlight Python code blocks', () => {
    setColorEnabled(true);
    const code = 'def greet(name):\n    # Say hello\n    return f"Hello, {name}"';
    const highlighted = highlightCode(code, 'python');
    const plain = stripAnsi(highlighted);

    assert.strictEqual(plain, code);
    assert.ok(highlighted.includes('\x1b['));
  });

  test('should highlight Bash code blocks', () => {
    setColorEnabled(true);
    const code = 'if [ -f "$FILE" ]; then\n  echo "Exists: $FILE"\nfi';
    const highlighted = highlightCode(code, 'bash');
    const plain = stripAnsi(highlighted);

    assert.strictEqual(plain, code);
    assert.ok(highlighted.includes('\x1b['));
  });

  test('should highlight JSON formatted content', () => {
    setColorEnabled(true);
    const jsonStr = '{\n  "name": "termux-ai",\n  "version": 1,\n  "active": true\n}';
    const highlighted = highlightCode(jsonStr, 'json');
    const plain = stripAnsi(highlighted);

    assert.strictEqual(plain, jsonStr);
    assert.ok(highlighted.includes('\x1b['));
  });

  test('should highlight SQL queries', () => {
    setColorEnabled(true);
    const sql = 'SELECT id, username FROM users WHERE active = 1 ORDER BY created_at DESC;';
    const highlighted = highlightCode(sql, 'sql');
    const plain = stripAnsi(highlighted);

    assert.strictEqual(plain, sql);
    assert.ok(highlighted.includes('\x1b['));
  });

  test('should highlight HTML markup', () => {
    setColorEnabled(true);
    const html = '<div class="alert"><span>Attention!</span></div>';
    const highlighted = highlightCode(html, 'html');
    const plain = stripAnsi(highlighted);

    assert.strictEqual(plain, html);
    assert.ok(highlighted.includes('\x1b['));
  });

  test('should parse and render Markdown tables into bordered Unicode tables', () => {
    setColorEnabled(true);
    const tableMd = `
| Name | Role | Status |
| :--- | :---: | ---: |
| Alice | Admin | Active |
| Bob | User | Pending |
`;
    const rendered = renderTable(tableMd);
    const plain = stripAnsi(rendered);

    assert.ok(plain.includes('┌'));
    assert.ok(plain.includes('┬'));
    assert.ok(plain.includes('┐'));
    assert.ok(plain.includes('Alice'));
    assert.ok(plain.includes('Admin'));
    assert.ok(plain.includes('Active'));
    assert.ok(plain.includes('Bob'));
    assert.ok(plain.includes('└'));
    assert.ok(plain.includes('┴'));
    assert.ok(plain.includes('┘'));
  });

  test('should render markdown code blocks inside full markdown document', () => {
    setColorEnabled(true);
    const doc = `
# Demo Report
Here is some code:
\`\`\`js
const answer = 42;
console.log(answer);
\`\`\`
Done!
`;
    const rendered = renderMarkdown(doc);
    const plain = stripAnsi(rendered);

    assert.ok(plain.includes('Demo Report'));
    assert.ok(plain.includes('const answer = 42;'));
    assert.ok(plain.includes('[js]'));
    assert.ok(plain.includes('Done!'));
  });
});

describe('Step 5: Terminal Box & Banner UI', () => {
  beforeEach(() => {
    setColorEnabled(true);
  });

  test('should render box with custom border style and title', () => {
    const box = renderBox('Hello from Termux AI CLI', {
      title: 'Status',
      borderStyle: 'round',
      borderColor: 'cyan'
    });
    const plain = stripAnsi(box);

    assert.ok(plain.includes('╭'));
    assert.ok(plain.includes('Status'));
    assert.ok(plain.includes('Hello from Termux AI CLI'));
    assert.ok(plain.includes('╰'));
  });

  test('should render application welcome banner', () => {
    const banner = renderBanner({
      title: '⚡ termux-ai-cli',
      version: 'v1.0.0',
      subtitle: 'Autonomous AI Agent CLI for Termux',
      details: ['Model: gemini-2.5-flash', 'Session: sess_test123']
    });
    const plain = stripAnsi(banner);

    assert.ok(plain.includes('termux-ai-cli'));
    assert.ok(plain.includes('v1.0.0'));
    assert.ok(plain.includes('Model: gemini-2.5-flash'));
  });

  test('should render status card key-value pairs', () => {
    const card = renderStatusCard('Session Info', {
      'ID': 'sess_999',
      'Turns': 5,
      'Active': true
    });
    const plain = stripAnsi(card);

    assert.ok(plain.includes('Session Info'));
    assert.ok(plain.includes('ID'));
    assert.ok(plain.includes('sess_999'));
    assert.ok(plain.includes('Turns'));
    assert.ok(plain.includes('5'));
  });
});

describe('Step 5: Live Spinner & Status Indicator', () => {
  beforeEach(() => {
    setColorEnabled(true);
  });

  test('should start, update text, and succeed on stream', () => {
    const mockStream = new PassThrough();
    let written = '';
    mockStream.on('data', chunk => {
      written += chunk.toString('utf8');
    });

    const spinner = createSpinner({
      text: 'Starting engine...',
      stream: mockStream,
      enabled: true
    });

    spinner.start();
    assert.strictEqual(spinner.isSpinning(), true);

    spinner.update('Executing tasks...');
    assert.strictEqual(spinner.text, 'Executing tasks...');

    spinner.succeed('Task completed successfully');
    assert.strictEqual(spinner.isSpinning(), false);

    const plain = stripAnsi(written);
    assert.ok(plain.includes('Task completed successfully'));
    assert.ok(plain.includes('✔'));
  });

  test('should support fail, warn, and info methods', () => {
    const mockStream = new PassThrough();
    let written = '';
    mockStream.on('data', chunk => {
      written += chunk.toString('utf8');
    });

    const spinner = createSpinner({ stream: mockStream, enabled: true });

    spinner.start('Warning test');
    spinner.warn('Careful here');

    spinner.start('Failure test');
    spinner.fail('Something went wrong');

    spinner.start('Info test');
    spinner.info('FYI message');

    const plain = stripAnsi(written);
    assert.ok(plain.includes('⚠ Careful here'));
    assert.ok(plain.includes('✖ Something went wrong'));
    assert.ok(plain.includes('ℹ FYI message'));
  });

  test('REPL_PROMPT should include APP_NAME constant', () => {
    assert.ok(REPL_PROMPT.includes(APP_NAME));
    assert.equal(APP_NAME, 'termuxai');
    assert.ok(REPL_PROMPT.includes('termuxai'));
  });
});
