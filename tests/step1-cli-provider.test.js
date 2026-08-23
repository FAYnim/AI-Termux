import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../src/cli/args.js';

describe('Step 1: CLI provider arg parsing', () => {
  test('--provider flag parsed into flags.provider', () => {
    const res = parseArgs(['--provider', 'openai', 'hello']);
    assert.equal(res.flags.provider, 'openai');
    assert.equal(res.prompt, 'hello');
  });

  test('--provider with = syntax', () => {
    const res = parseArgs(['--provider=openai', 'hello']);
    assert.equal(res.flags.provider, 'openai');
  });

  test('--provider composes with --model and --api-key', () => {
    const res = parseArgs(['--provider', 'openai', '--model', 'gpt-4o', '--api-key', 'k1', 'x']);
    assert.equal(res.flags.provider, 'openai');
    assert.equal(res.flags.model, 'gpt-4o');
    assert.equal(res.flags.apiKey, 'k1');
  });
});
