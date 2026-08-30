import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseArgs } from '../src/cli/args.js';

describe('CLI Argument Parser (src/cli/args.js)', () => {
  test('should return default structure for empty arguments', () => {
    const res = parseArgs([]);
    assert.equal(res.command, null);
    assert.equal(res.subcommand, null);
    assert.equal(res.prompt, null);
    assert.equal(res.flags.help, false);
    assert.equal(res.flags.version, false);
    assert.equal(res.flags.yes, false);
    assert.equal(res.flags.model, null);
  });

  test('should parse --help and -h flags', () => {
    const res1 = parseArgs(['--help']);
    assert.equal(res1.flags.help, true);
    assert.equal(res1.command, 'help');

    const res2 = parseArgs(['-h']);
    assert.equal(res2.flags.help, true);
    assert.equal(res2.command, 'help');
  });

  test('should parse --version and -v flags', () => {
    const res1 = parseArgs(['--version']);
    assert.equal(res1.flags.version, true);
    assert.equal(res1.command, 'version');

    const res2 = parseArgs(['-v']);
    assert.equal(res2.flags.version, true);
    assert.equal(res2.command, 'version');
  });

  test('should parse model flag (--model and -m and --model=)', () => {
    const res1 = parseArgs(['--model', 'gemini-2.5-pro']);
    assert.equal(res1.flags.model, 'gemini-2.5-pro');

    const res2 = parseArgs(['-m', 'gemini-1.5-pro']);
    assert.equal(res2.flags.model, 'gemini-1.5-pro');

    const res3 = parseArgs(['--model=gemini-2.0-flash']);
    assert.equal(res3.flags.model, 'gemini-2.0-flash');
  });

  test('should parse api key flag (--api-key and -k and --api-key=)', () => {
    const res1 = parseArgs(['--api-key', 'secret-key-123']);
    assert.equal(res1.flags.apiKey, 'secret-key-123');

    const res2 = parseArgs(['-k', 'secret-key-456']);
    assert.equal(res2.flags.apiKey, 'secret-key-456');

    const res3 = parseArgs(['--api-key=secret-key-789']);
    assert.equal(res3.flags.apiKey, 'secret-key-789');
  });

  test('should parse session flag (--session and -s and --session=)', () => {
    const res1 = parseArgs(['--session', 'sess-001']);
    assert.equal(res1.flags.session, 'sess-001');

    const res2 = parseArgs(['-s', 'sess-002']);
    assert.equal(res2.flags.session, 'sess-002');

    const res3 = parseArgs(['--session=sess-003']);
    assert.equal(res3.flags.session, 'sess-003');
  });

  test('should parse boolean flags (-y, --yes, --verbose)', () => {
    const res1 = parseArgs(['-y', '--verbose']);
    assert.equal(res1.flags.yes, true);
    assert.equal(res1.flags.verbose, true);

    const res2 = parseArgs(['--yes']);
    assert.equal(res2.flags.yes, true);
  });

  test('should parse timeout and config-dir flags', () => {
    const res1 = parseArgs(['--timeout', '45000', '--config-dir', '/tmp/test-termuxai']);
    assert.equal(res1.flags.timeout, 45000);
    assert.equal(res1.flags.configDir, '/tmp/test-termuxai');

    const res2 = parseArgs(['--timeout=60000', '--config-dir=/tmp/other-termuxai']);
    assert.equal(res2.flags.timeout, 60000);
    assert.equal(res2.flags.configDir, '/tmp/other-termuxai');
  });

  test('should parse config subcommands', () => {
    const res1 = parseArgs(['config', 'set', 'model', 'gemini-2.5-pro']);
    assert.equal(res1.command, 'config');
    assert.equal(res1.subcommand, 'set');
    assert.deepEqual(res1.args, ['model', 'gemini-2.5-pro']);

    const res2 = parseArgs(['config', 'get', 'apiKey']);
    assert.equal(res2.command, 'config');
    assert.equal(res2.subcommand, 'get');
    assert.deepEqual(res2.args, ['apiKey']);

    const res3 = parseArgs(['config', 'list']);
    assert.equal(res3.command, 'config');
    assert.equal(res3.subcommand, 'list');

    const res4 = parseArgs(['config']);
    assert.equal(res4.command, 'config');
    assert.equal(res4.subcommand, 'list');
  });

  test('should parse resume and session subcommands', () => {
    const res1 = parseArgs(['resume', 'session-123']);
    assert.equal(res1.command, 'resume');
    assert.equal(res1.subcommand, 'session-123');

    const res2 = parseArgs(['session', 'list']);
    assert.equal(res2.command, 'session');
    assert.equal(res2.subcommand, 'list');
  });

  test('should parse single and multi-word prompts', () => {
    const res1 = parseArgs(['buatkan', 'fungsi', 'kalkulator']);
    assert.equal(res1.command, 'chat');
    assert.equal(res1.prompt, 'buatkan fungsi kalkulator');

    const res2 = parseArgs(['--model', 'gemini-2.5-pro', '-y', 'perbaiki', 'test', 'error']);
    assert.equal(res2.command, 'chat');
    assert.equal(res2.flags.model, 'gemini-2.5-pro');
    assert.equal(res2.flags.yes, true);
    assert.equal(res2.prompt, 'perbaiki test error');
  });
});
