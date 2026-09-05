/**
 * Unit Tests: REPL Session Status Line Wiring & /session Usage Rows
 * Feature: Session status line (tokens · context · loops)
 */

import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { describe, test } from 'node:test';
import { Session } from '../src/agent/session.js';
import { accumulateUsage } from '../src/agent/usage.js';
import { startRepl } from '../src/cli/repl.js';
import { executeSlashCommand } from '../src/cli/slash-commands.js';
import { renderStatusLine } from '../src/ui/box.js';

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };
const stubConfigMgr = { get: () => undefined };

function createIO() {
  const input = new PassThrough();
  const output = new PassThrough();
  let text = '';
  output.on('data', (chunk) => {
    text += chunk.toString();
  });
  return { input, output, getText: () => text };
}

function createFakeOrchestrator(session, behavior = {}) {
  return {
    provider: 'gemini',
    workingDir: '/tmp/fake',
    maxIterations: 30,
    maxContextTokens: undefined,
    llmClient: { getModel: () => 'gemini-2.5-flash' },
    getSession: () => session,
    async runTurn(_prompt, opts = {}) {
      opts.onIterationStart?.(1);
      if (behavior.usage) {
        accumulateUsage(session, behavior.usage);
      }
      if (behavior.throw) {
        throw new Error(behavior.throw);
      }
      return {
        success: true,
        text: 'fake reply',
        iterations: 1,
        toolCalls: [],
        loopLimitReached: false,
        session,
      };
    },
  };
}

describe('REPL Session Status Line', () => {
  test('prints the status line above the next prompt after a turn', async () => {
    const session = new Session({});
    const io = createIO();
    const orchestrator = createFakeOrchestrator(session, {
      usage: { promptTokenCount: 5000, candidatesTokenCount: 200, totalTokenCount: 5200 },
    });

    const replDone = startRepl({
      orchestrator,
      configMgr: stubConfigMgr,
      input: io.input,
      output: io.output,
      logger: silentLogger,
    });
    io.input.write('hello\n');
    // After agent turn resolves, send /exit to break the loop, then close input.
    setTimeout(() => {
      io.input.write('/exit\n');
      setTimeout(() => io.input.end(), 30);
    }, 30);
    await replDone;

    const text = io.getText();
    assert.ok(
      text.includes('5.2k tok') && text.includes('0%') && text.includes('loop 1/30'),
      `status line missing in:\n${text}`,
    );
  });

  test('prints an estimated (~) line when the turn errors', async () => {
    const session = new Session({});
    const io = createIO();
    const orchestrator = createFakeOrchestrator(session, { throw: 'boom' });

    const replDone = startRepl({
      orchestrator,
      configMgr: stubConfigMgr,
      input: io.input,
      output: io.output,
      logger: silentLogger,
    });
    io.input.write('hello\n');
    setTimeout(() => {
      io.input.write('/exit\n');
      setTimeout(() => io.input.end(), 30);
    }, 30);
    await replDone;

    assert.ok(io.getText().includes('~0 tok'), 'expected ~0 tok status line after error');
  });

  test('prints no status line when no agent turn runs', async () => {
    const session = new Session({});
    const io = createIO();
    const orchestrator = createFakeOrchestrator(session);

    const replDone = startRepl({
      orchestrator,
      configMgr: stubConfigMgr,
      input: io.input,
      output: io.output,
      logger: silentLogger,
    });
    io.input.write('/exit\n');
    setTimeout(() => io.input.end(), 30);
    await replDone;

    assert.ok(!io.getText().includes('│ ctx'), 'status line must not appear without an agent turn');
  });
});

describe('/session usage rows', () => {
  test('card shows API usage rows', async () => {
    const session = new Session({});
    accumulateUsage(session, {
      promptTokenCount: 5000,
      candidatesTokenCount: 200,
      totalTokenCount: 5200,
    });
    const orchestrator = { session, llmClient: { getModel: () => 'gemini-2.5-flash' } };

    const io = createIO();
    await executeSlashCommand('/session', {
      orchestrator,
      configMgr: stubConfigMgr,
      stream: io.output,
    });

    const text = io.getText();
    assert.ok(text.includes('API Requests'), `missing API Requests row:\n${text}`);
    assert.ok(text.includes('API Prompt Tokens'), `missing API Prompt Tokens row:\n${text}`);
    assert.ok(
      text.includes('API Completion Tokens'),
      `missing API Completion Tokens row:\n${text}`,
    );
    assert.ok(text.includes('API Total Tokens'), `missing API Total Tokens row:\n${text}`);
  });
});

test('status line renders infinity cap as ∞', () => {
  const line = renderStatusLine({
    usage: { totalTokens: 1234, llmRequests: 2 },
    contextTokens: 100,
    contextBudget: 920000,
    iterations: 47,
    maxIterations: Infinity,
  });
  assert.match(line, /loop 47\/∞/);
});
