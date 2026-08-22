/**
 * E2E Test: Autonomous Self-Healing Bug Fix Loop
 *
 * Scenario:
 *   1. AI writes a `calc.js` with a bug (subtract instead of add)
 *   2. AI writes `test-calc.js` that expects the correct result
 *   3. Agent runs `node test-calc.js` -> fails (non-zero exit code)
 *   4. Agent reads the error output (error feedback injection)
 *   5. Agent uses `patch_file` to fix the bug in `calc.js`
 *   6. Agent re-runs `node test-calc.js` -> passes (exit code 0)
 *   7. Agent confirms success in final text response
 *
 * This test exercises: AgentOrchestrator, executeCommandTool, patchFileTool,
 * writeFileTool, readFileTool, SecurityGuard, Session persistence, and
 * the multi-turn error feedback injection mechanism.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { AgentOrchestrator } from '../../src/agent/orchestrator.js';
import { SessionManager } from '../../src/agent/session.js';
import { SecurityGuard } from '../../src/security/guard.js';
import { writeFileTool } from '../../src/tools/write_file.js';
import { patchFileTool } from '../../src/tools/patch_file.js';
import { executeCommandTool } from '../../src/tools/execute_command.js';
import { readFileTool } from '../../src/tools/read_file.js';
import { dispatchToolCall } from '../../src/tools/registry.js';

describe('E2E Step 6: Autonomous Self-Healing Bug Fix Loop', () => {
  let tempDir;
  let sessionManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'termuxai-e2e-selfheal-'));
    sessionManager = new SessionManager({ sessionsDir: tempDir });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // ─────────────────────────────────────────────────────────────
  // Test 1: writeFileTool + executeCommandTool + patchFileTool
  // Full self-healing flow without LLM (direct tool calls)
  // ─────────────────────────────────────────────────────────────
  test('Direct tool pipeline: write buggy file, detect failure, patch, verify pass', async () => {
    const context = { baseDir: tempDir, autoApprove: true };

    // Step 1: AI writes buggy calc.js (uses subtraction instead of addition)
    await writeFileTool({
      filePath: 'calc.js',
      content: `// Calculator module\nexport function add(a, b) {\n  return a - b; // BUG: should be a + b\n}\n`
    }, context);

    // Step 2: AI writes test-calc.js
    await writeFileTool({
      filePath: 'test-calc.js',
      content: `import { add } from './calc.js';\nconst result = add(3, 4);\nif (result !== 7) {\n  console.error('FAIL: add(3, 4) returned ' + result + ', expected 7');\n  process.exit(1);\n}\nconsole.log('PASS: add(3, 4) ===', result);\n`
    }, context);

    // Verify both files exist
    assert.ok(fs.existsSync(path.join(tempDir, 'calc.js')), 'calc.js should exist');
    assert.ok(fs.existsSync(path.join(tempDir, 'test-calc.js')), 'test-calc.js should exist');

    // Step 3: AI runs the test -> should FAIL
    const failRun = await executeCommandTool({
      command: `node test-calc.js`,
      workingDir: tempDir
    }, context);

    assert.notEqual(failRun.exitCode, 0, `Test should fail initially. exitCode: ${failRun.exitCode}`);
    assert.match(
      failRun.stderr + failRun.stdout,
      /FAIL|expected 7/i,
      'Failure output should contain FAIL or expected 7'
    );

    // Step 4: Agent detects the error and applies patch
    const patchResult = await patchFileTool({
      filePath: 'calc.js',
      searchString: 'return a - b; // BUG: should be a + b',
      replaceString: 'return a + b; // FIXED'
    }, context);

    assert.equal(patchResult.success, true, 'Patch should succeed');
    assert.match(patchResult.message, /Successfully patched/);

    // Verify the fix was applied
    const calcContent = fs.readFileSync(path.join(tempDir, 'calc.js'), 'utf8');
    assert.ok(calcContent.includes('return a + b'), 'calc.js should now contain the fix');
    assert.ok(!calcContent.includes('return a - b'), 'calc.js should no longer have the bug');

    // Step 5: AI re-runs the test -> should PASS
    const passRun = await executeCommandTool({
      command: `node test-calc.js`,
      workingDir: tempDir
    }, context);

    assert.equal(passRun.exitCode, 0, `Test should pass after patch. stderr: ${passRun.stderr}`);
    assert.match(passRun.stdout, /PASS/, 'Output should confirm PASS');
  });

  // ─────────────────────────────────────────────────────────────
  // Test 2: Read file content after write
  // ─────────────────────────────────────────────────────────────
  test('readFileTool correctly reads written file content', async () => {
    const context = { baseDir: tempDir };

    const content = `export function multiply(a, b) {\n  return a * b;\n}\n`;
    await writeFileTool({ filePath: 'math.js', content }, context);

    const readResult = await readFileTool({ filePath: 'math.js' }, context);

    assert.equal(readResult.content, content, 'readFileTool should return exact written content');
    assert.ok(readResult.totalLines >= 3, 'Should have at least 3 lines');
  });

  // ─────────────────────────────────────────────────────────────
  // Test 3: Full Orchestrator Self-Healing Simulation (mock LLM)
  // Multi-turn: Write -> Test(fail) -> Patch -> Test(pass) -> Final Answer
  // ─────────────────────────────────────────────────────────────
  test('Orchestrator simulation: multi-turn self-healing bug fix via mock Gemini', async () => {
    // Pre-create buggy files in tempDir
    const calcPath = path.join(tempDir, 'calc.js');
    const testPath = path.join(tempDir, 'test-calc.js');

    fs.writeFileSync(calcPath,
      `export function add(a, b) {\n  return a - b; // BUG\n}\n`, 'utf8');
    fs.writeFileSync(testPath,
      `import { add } from './calc.js';\nconst r = add(2, 3);\nif (r !== 5) { console.error('FAIL: got ' + r); process.exit(1); }\nconsole.log('PASS');\n`, 'utf8');

    let turn = 0;

    // Simulates: test -> detect failure output -> patch -> re-test -> answer
    const mockGemini = {
      getModel: () => 'gemini-2.5-flash',
      generateStream: async ({ contents }) => {
        turn++;

        if (turn === 1) {
          // Turn 1: Run tests first to check current state
          return {
            text: 'Saya akan menjalankan tes terlebih dahulu untuk melihat kondisi awal.',
            functionCalls: [{ name: 'execute_command', args: { command: 'node test-calc.js', workingDir: tempDir } }],
            finishReason: 'STOP'
          };
        }

        if (turn === 2) {
          // Turn 2: Tests failed. Read calc.js to inspect code.
          // The function response (last message) should contain the error
          const lastMsg = contents[contents.length - 1];
          const hasFail = JSON.stringify(lastMsg).includes('FAIL') ||
                          JSON.stringify(lastMsg).includes('exitCode') ||
                          JSON.stringify(lastMsg).includes('process.exit');
          // We accept this step regardless as the mock doesn't have real output
          return {
            text: 'Tes gagal. Saya akan memeriksa kode calc.js untuk menemukan bug.',
            functionCalls: [{ name: 'read_file', args: { filePath: 'calc.js' } }],
            finishReason: 'STOP'
          };
        }

        if (turn === 3) {
          // Turn 3: Found bug. Apply patch.
          return {
            text: 'Saya menemukan bug: menggunakan subtraksi, bukan penjumlahan. Saya akan memperbaikinya.',
            functionCalls: [{
              name: 'patch_file',
              args: {
                filePath: 'calc.js',
                searchString: 'return a - b; // BUG',
                replaceString: 'return a + b; // FIXED'
              }
            }],
            finishReason: 'STOP'
          };
        }

        if (turn === 4) {
          // Turn 4: Re-run tests to confirm fix
          return {
            text: 'Bug telah diperbaiki. Saya akan menjalankan ulang tes untuk verifikasi.',
            functionCalls: [{ name: 'execute_command', args: { command: 'node test-calc.js', workingDir: tempDir } }],
            finishReason: 'STOP'
          };
        }

        // Turn 5+: Tests passed. Provide final answer.
        return {
          text: 'Tes berhasil lulus! Bug telah berhasil diperbaiki. Fungsi add() kini mengembalikan hasil penjumlahan yang benar.',
          functionCalls: [],
          finishReason: 'STOP'
        };
      }
    };

    const session = sessionManager.createSession({ workingDir: tempDir });
    const orchestrator = new AgentOrchestrator({
      geminiClient: mockGemini,
      session,
      workingDir: tempDir,
      autoApprove: true
    });

    const result = await orchestrator.runTurn(
      'Ada bug di calc.js, tolong perbaiki secara otomatis dan pastikan semua tes lulus.',
      { maxIterations: 10 }
    );

    assert.equal(result.success, true, `Loop should succeed. loopLimitReached: ${result.loopLimitReached}`);
    assert.ok(result.toolCalls.length >= 4, `Should have called at least 4 tools, got: ${result.toolCalls.length}`);
    assert.ok(result.iterations >= 5, `Should have run at least 5 iterations, got: ${result.iterations}`);
    assert.match(result.text, /berhasil|PASS|diperbaiki/i, 'Final text should confirm success');

    // Verify the actual file was patched
    const fixedContent = fs.readFileSync(calcPath, 'utf8');
    assert.ok(fixedContent.includes('return a + b'), 'calc.js should have been fixed');
    assert.ok(!fixedContent.includes('return a - b'), 'Bug line should be gone');

    // Verify session was saved
    const savedMessages = session.getMessages();
    assert.ok(savedMessages.length >= 3, 'Session should contain multiple turns of conversation');
  });

  // ─────────────────────────────────────────────────────────────
  // Test 4: SecurityGuard blocks blacklisted commands
  // ─────────────────────────────────────────────────────────────
  test('dispatchToolCall respects SecurityGuard authorization when tool call is blocked', async () => {
    const securityGuard = new SecurityGuard({
      autoApprove: false,
      baseDir: tempDir,
      // Custom confirmation handler that always says NO
      confirmationHandler: async () => false
    });

    // rm -rf / is in the blacklist and should be outright rejected
    const result = await dispatchToolCall('execute_command', {
      command: 'rm -rf /'
    }, { securityGuard, baseDir: tempDir });

    assert.equal(result.error, true, 'Blacklisted command should be blocked');
    assert.match(result.message, /Forbidden|blacklist|blocked/i, 'Should explain why it was blocked');
  });

  // ─────────────────────────────────────────────────────────────
  // Test 5: Auto-approve allows risky command without prompting
  // ─────────────────────────────────────────────────────────────
  test('SecurityGuard auto-approve flag bypasses confirmation prompt', async () => {
    const securityGuard = new SecurityGuard({
      autoApprove: true,
      baseDir: tempDir
    });

    // echo is safe, just a validation test
    const result = await dispatchToolCall('execute_command', {
      command: 'node --version'
    }, { securityGuard, baseDir: tempDir });

    assert.equal(result.error, undefined, `Should not be an error. message: ${result.message}`);
    assert.equal(result.success, true, 'node --version should execute successfully');
    assert.match(result.result.stdout, /v\d+\.\d+/, 'Should output Node.js version string');
  });
});
