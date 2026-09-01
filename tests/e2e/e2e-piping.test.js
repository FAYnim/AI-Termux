/**
 * E2E Test: UNIX Stdin Piping & Analysis Workflow
 *
 * Scenario:
 *   1. Simulated log data is provided as piped stdin content
 *   2. `readPipedStdin` reads the stream to completion
 *   3. `mergePipedPrompt` combines content with user instruction
 *   4. `runSingleShot` routes the merged prompt through orchestrator
 *   5. Output is validated for format and content quality
 *
 * This test exercises: isPipedInput, readPipedStdin, mergePipedPrompt,
 * runSingleShot, and the full CLI piping pipeline.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { AgentOrchestrator } from '../../src/agent/orchestrator.js';
import { SessionManager } from '../../src/agent/session.js';
import { isPipedInput, mergePipedPrompt, readPipedStdin } from '../../src/cli/piping.js';
import { runSingleShot } from '../../src/cli/single-shot.js';

// ── Sample log data ────────────────────────────────────────────────────────
const SAMPLE_ERROR_LOG = `
2024-01-15 10:23:45 ERROR [API] Connection timeout from 192.168.1.101 - route /api/data
2024-01-15 10:23:46 WARN  [DB]  Slow query detected: 2340ms on table users
2024-01-15 10:23:47 ERROR [API] 500 Internal Server Error - POST /api/upload from 10.0.0.55
2024-01-15 10:23:48 INFO  [SYS] Health check passed
2024-01-15 10:23:49 ERROR [API] Connection timeout from 192.168.1.101 - route /api/data
2024-01-15 10:23:50 ERROR [API] Auth token expired from 172.16.0.22 - route /api/admin
2024-01-15 10:23:51 WARN  [DB]  Connection pool exhausted (20/20 connections in use)
2024-01-15 10:23:52 ERROR [CACHE] Redis connection refused at 127.0.0.1:6379
`.trim();

const SAMPLE_GIT_DIFF = `
diff --git a/src/app.js b/src/app.js
index 3a4b2c1..7d8e9f0 100644
--- a/src/app.js
+++ b/src/app.js
@@ -12,7 +12,6 @@ import express from 'express';
 const app = express();
 
-app.use(express.json({ limit: '10kb' }));
+app.use(express.json({ limit: '100kb' }));
 app.use(cors());
`.trim();

// ─────────────────────────────────────────────────────────────────────────────

describe('E2E Step 6: UNIX Stdin Piping & Analysis Workflow', () => {
  let tempDir;
  let sessionManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faycli-e2e-piping-'));
    sessionManager = new SessionManager({ sessionsDir: tempDir });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // ──────────────────────────────────────────────────────────────
  // Test 1: isPipedInput detects piped vs TTY streams
  // ──────────────────────────────────────────────────────────────
  test('isPipedInput correctly detects piped and TTY streams', () => {
    const ttyStream = { isTTY: true };
    const pipedStream = { isTTY: false };
    const undefinedStream = { isTTY: undefined };

    assert.strictEqual(
      isPipedInput(ttyStream),
      false,
      'TTY stream should not be detected as piped',
    );
    assert.strictEqual(
      isPipedInput(pipedStream),
      true,
      'Non-TTY stream should be detected as piped',
    );
    assert.strictEqual(
      isPipedInput(undefinedStream),
      false,
      'Undefined isTTY should not be detected as piped',
    );
    assert.strictEqual(isPipedInput(null), false, 'null stream should return false');
    assert.strictEqual(isPipedInput(undefined), false, 'undefined stream should return false');
  });

  // ──────────────────────────────────────────────────────────────
  // Test 2: readPipedStdin reads multi-chunk log data
  // ──────────────────────────────────────────────────────────────
  test('readPipedStdin reads complete multi-chunk simulated log stream', async () => {
    const mockStream = new Readable({ read() {} });
    mockStream.isTTY = false;

    const logLines = SAMPLE_ERROR_LOG.split('\n');

    // Push chunks asynchronously (simulating real pipe behavior)
    process.nextTick(() => {
      for (let i = 0; i < logLines.length; i++) {
        mockStream.push(logLines[i] + (i < logLines.length - 1 ? '\n' : ''));
      }
      mockStream.push(null); // EOF
    });

    const result = await readPipedStdin({ stream: mockStream, timeoutMs: 2000 });

    assert.ok(result.length > 0, 'Should return non-empty content');
    assert.ok(result.includes('192.168.1.101'), 'Should contain IP address from log');
    assert.ok(result.includes('ERROR'), 'Should contain ERROR entries');
    assert.ok(result.includes('WARN'), 'Should contain WARN entries');
    assert.ok(result.includes('Redis'), 'Should contain Redis error entry');
  });

  // ──────────────────────────────────────────────────────────────
  // Test 3: readPipedStdin handles binary-safe Buffer chunks
  // ──────────────────────────────────────────────────────────────
  test('readPipedStdin handles Buffer chunks correctly', async () => {
    const mockStream = new Readable({ read() {} });
    mockStream.isTTY = false;

    process.nextTick(() => {
      mockStream.push(Buffer.from('First chunk\n'));
      mockStream.push(Buffer.from('Second chunk\n'));
      mockStream.push(Buffer.from('Third chunk'));
      mockStream.push(null);
    });

    const result = await readPipedStdin({ stream: mockStream, timeoutMs: 2000 });

    assert.equal(
      result,
      'First chunk\nSecond chunk\nThird chunk',
      'Should join all Buffer chunks correctly',
    );
  });

  // ──────────────────────────────────────────────────────────────
  // Test 4: readPipedStdin rejects if input exceeds maxBytes
  // ──────────────────────────────────────────────────────────────
  test('readPipedStdin rejects if piped input exceeds maxBytes limit', async () => {
    const mockStream = new Readable({ read() {} });
    mockStream.isTTY = false;

    const bigChunk = Buffer.alloc(1024 * 1024, 'A'); // 1 MB

    process.nextTick(() => {
      mockStream.push(bigChunk);
      mockStream.push(bigChunk);
      mockStream.push(bigChunk);
    });

    await assert.rejects(
      () => readPipedStdin({ stream: mockStream, maxBytes: 1024, timeoutMs: 2000 }),
      (err) => {
        assert.match(err.message, /exceeded maximum size/i, 'Error should mention size limit');
        return true;
      },
    );
  });

  // ──────────────────────────────────────────────────────────────
  // Test 5: mergePipedPrompt combines log content + instruction
  // ──────────────────────────────────────────────────────────────
  test('mergePipedPrompt creates structured prompt from log + instruction', () => {
    const merged = mergePipedPrompt(SAMPLE_ERROR_LOG, 'Ekstrak daftar IP dan pesan error utama');

    assert.ok(merged.includes('Piped Input Content'), 'Should contain header label');
    assert.ok(merged.includes('Ekstrak daftar IP'), 'Should include user instruction');
    assert.ok(merged.includes('192.168.1.101'), 'Should include log content');
    assert.ok(merged.includes('[Instruction]'), 'Should have instruction separator');
  });

  // ──────────────────────────────────────────────────────────────
  // Test 6: mergePipedPrompt without user instruction uses default
  // ──────────────────────────────────────────────────────────────
  test('mergePipedPrompt generates default instruction when user prompt is empty', () => {
    const mergedNoInstruction = mergePipedPrompt(SAMPLE_GIT_DIFF, '');

    assert.ok(
      mergedNoInstruction.includes('Piped Input Content'),
      'Should contain piped content header',
    );
    assert.ok(mergedNoInstruction.includes('diff --git'), 'Should include the git diff content');
    assert.ok(
      mergedNoInstruction.includes('analyze') || mergedNoInstruction.includes('process'),
      'Should include default analysis instruction',
    );
  });

  // ──────────────────────────────────────────────────────────────
  // Test 7: mergePipedPrompt with empty content returns only instruction
  // ──────────────────────────────────────────────────────────────
  test('mergePipedPrompt returns bare instruction when piped content is empty', () => {
    const result = mergePipedPrompt('', 'Buat commit message yang jelas');
    assert.equal(
      result,
      'Buat commit message yang jelas',
      'Should return raw instruction when no piped content',
    );
  });

  // ──────────────────────────────────────────────────────────────
  // Test 8: Full pipe-to-agent analysis via runSingleShot + mock LLM
  // ──────────────────────────────────────────────────────────────
  test('Full piping flow: stream -> merge prompt -> runSingleShot -> mock analysis response', async () => {
    const session = sessionManager.createSession({ workingDir: tempDir });

    // Mock Gemini client that returns structured analysis
    const mockGemini = {
      getModel: () => 'gemini-2.5-flash',
      generateStream: async ({ contents }) => {
        // Verify the prompt was properly merged and sent
        const lastUserMsg = contents.find((c) => c.role === 'user');
        const userText = JSON.stringify(lastUserMsg);

        const hasLogContent = userText.includes('192.168.1.101') || userText.includes('ERROR');
        const hasInstruction = userText.includes('IP') || userText.includes('Ekstrak');

        assert.ok(
          hasLogContent || hasInstruction,
          'Prompt to LLM should contain piped log data or instruction',
        );

        return {
          text: `## Analisis Log Error\n\n**IP Addresses yang Ditemukan:**\n- 192.168.1.101 (timeout berulang)\n- 10.0.0.55 (server error 500)\n- 172.16.0.22 (token expired)\n\n**Masalah Utama:**\n1. API timeout dari 192.168.1.101 terjadi 2x\n2. Koneksi Redis ke 127.0.0.1:6379 ditolak\n3. Connection pool database exhausted`,
          functionCalls: [],
          finishReason: 'STOP',
        };
      },
    };

    const orchestrator = new AgentOrchestrator({
      llmClient: mockGemini,
      session,
      workingDir: tempDir,
      autoApprove: true,
      maxIterations: 10, // bound the loop (default is now unlimited)
    });

    // Simulate piped stdin content (log) + user instruction
    const mockStream = new Readable({ read() {} });
    mockStream.isTTY = false;
    process.nextTick(() => {
      mockStream.push(Buffer.from(SAMPLE_ERROR_LOG));
      mockStream.push(null);
    });

    const pipedContent = await readPipedStdin({ stream: mockStream, timeoutMs: 2000 });
    const mergedPrompt = mergePipedPrompt(pipedContent, 'Ekstrak daftar IP dan pesan error utama');

    // Capture output without writing to real stdout
    const outputChunks = [];
    const mockOutput = new PassThrough();
    mockOutput.on('data', (chunk) => outputChunks.push(chunk.toString()));

    const result = await runSingleShot(mergedPrompt, {
      orchestrator,
      stream: mockOutput,
      streamTokens: false,
    });

    mockOutput.end();

    assert.equal(result.success, true, 'Single-shot piping run should succeed');
    assert.ok(result.text.includes('Analisis'), 'Response should contain analysis heading');
    assert.ok(result.text.includes('192.168.1.101'), 'Response should reference identified IP');
    assert.ok(result.toolCalls.length === 0, 'Log analysis should not require tool calls');

    const output = outputChunks.join('');
    assert.ok(output.length > 0, 'Should produce some terminal output');
  });

  // ──────────────────────────────────────────────────────────────
  // Test 9: readPipedStdin returns empty for TTY stream
  // ──────────────────────────────────────────────────────────────
  test('readPipedStdin returns empty string for TTY stream (no piping)', async () => {
    const ttyStream = new Readable({ read() {} });
    ttyStream.isTTY = true;

    const result = await readPipedStdin({ stream: ttyStream, timeoutMs: 500 });
    assert.equal(result, '', 'TTY stream should immediately resolve with empty string');
  });

  // ──────────────────────────────────────────────────────────────
  // Test 10: Git diff piping simulation
  // ──────────────────────────────────────────────────────────────
  test('Git diff content is correctly read and merged with commit message instruction', async () => {
    const mockStream = new Readable({ read() {} });
    mockStream.isTTY = false;

    process.nextTick(() => {
      mockStream.push(Buffer.from(SAMPLE_GIT_DIFF));
      mockStream.push(null);
    });

    const pipedContent = await readPipedStdin({ stream: mockStream, timeoutMs: 2000 });
    const mergedPrompt = mergePipedPrompt(
      pipedContent,
      'Buat pesan commit yang ringkas dan deskriptif',
    );

    assert.ok(pipedContent.includes('diff --git'), 'Piped content should contain git diff');
    assert.ok(pipedContent.includes('express.json'), 'Piped content should contain changed code');
    assert.ok(
      mergedPrompt.includes('Buat pesan commit'),
      'Merged prompt should include instruction',
    );
    assert.ok(mergedPrompt.includes('diff --git'), 'Merged prompt should include git diff content');
  });
});
