#!/usr/bin/env node

/**
 * Termux AI CLI (`termuxai`) — Performance Benchmark Script
 *
 * Measures startup latency and memory footprint against PRD Non-Functional Requirements:
 *   - Startup Time < 300 ms
 *   - Memory RSS   < 50 MB
 *
 * Usage:
 *   node scripts/benchmark.js
 *   node scripts/benchmark.js --iterations 10
 *   node scripts/benchmark.js --json
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const ENTRY = path.join(ROOT_DIR, 'bin', 'tai.js');

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

const ANSI = {
  reset: '\x1b[0m',
  bold: (s) => `\x1b[1m${s}\x1b[22m`,
  green: (s) => `\x1b[32m${s}\x1b[39m`,
  red: (s) => `\x1b[31m${s}\x1b[39m`,
  yellow: (s) => `\x1b[33m${s}\x1b[39m`,
  cyan: (s) => `\x1b[36m${s}\x1b[39m`,
  dim: (s) => `\x1b[2m${s}\x1b[22m`,
  blue: (s) => `\x1b[34m${s}\x1b[39m`,
};

function hr(char = '─', width = 60) {
  return char.repeat(width);
}

function padRight(str, len) {
  return String(str).padEnd(len, ' ');
}

function padLeft(str, len) {
  return String(str).padStart(len, ' ');
}

function formatMs(ms) {
  return `${ms.toFixed(2)} ms`;
}

function formatMB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function statusBadge(pass) {
  return pass ? ANSI.green('✔ PASS') : ANSI.red('✘ FAIL');
}

// -------------------------------------------------------------------
// Benchmark: Startup Time
// Spawns `node bin/tai.js --version` and measures wall-clock time
// -------------------------------------------------------------------

function measureStartupTime(iterations = 5) {
  const times = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const result = spawnSync(process.execPath, [ENTRY, '--version'], {
      cwd: ROOT_DIR,
      env: { ...process.env, TERMUXAI_CONFIG_DIR: path.join(ROOT_DIR, '.benchmark-tmp') },
      encoding: 'utf8',
      timeout: 10000,
    });
    const elapsed = performance.now() - start;

    if (result.status !== 0 && result.status !== null) {
      // Non-zero may just mean missing API key — timing is still valid
    }
    times.push(elapsed);
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  return { avg, min, max, times };
}

// ── Simplified synchronous memory probe (no async imports) ──────────────────────
// ─────────────────────────────────────────────────────────────────────────────────

const SYNC_MEMORY_PROBE = `
import('../src/config/manager.js').then(() =>
import('../src/utils/ansi.js')).then(() =>
import('../src/utils/logger.js')).then(() =>
import('../src/utils/termux.js')).then(() =>
import('../src/security/guard.js')).then(() =>
import('../src/tools/registry.js')).then(() =>
import('../src/llm/gemini.js')).then(() =>
import('../src/llm/retry.js')).then(() =>
import('../src/agent/orchestrator.js')).then(() =>
import('../src/ui/markdown.js')).then(() =>
import('../src/cli/args.js')).then(() => {
  return new Promise(r => setTimeout(r, 100));
}).then(() => {
  const mem = process.memoryUsage();
  process.stdout.write(JSON.stringify(mem));
  process.exit(0);
});
`;

function measureMemorySync(iterations = 3) {
  const results = [];

  for (let i = 0; i < iterations; i++) {
    const result = spawnSync(process.execPath, ['--input-type=module'], {
      input: SYNC_MEMORY_PROBE,
      cwd: ROOT_DIR,
      env: { ...process.env, TERMUXAI_CONFIG_DIR: path.join(ROOT_DIR, '.benchmark-tmp') },
      encoding: 'utf8',
      timeout: 20000,
    });

    if (result.stdout?.trim()) {
      try {
        const mem = JSON.parse(result.stdout.trim());
        results.push(mem);
      } catch {
        // ignore parse failure
      }
    }
  }

  // Cleanup temp dir
  spawnSync(
    process.execPath,
    [
      '-e',
      `
    import { rmSync } from 'node:fs';
    try { rmSync('.benchmark-tmp', { recursive: true, force: true }); } catch {}
  `,
    ],
    { cwd: ROOT_DIR, encoding: 'utf8', timeout: 5000 },
  );

  return results;
}

// -------------------------------------------------------------------
// In-process memory measurement (simplest, most accurate for this process)
// -------------------------------------------------------------------

async function measureCurrentProcessMemory() {
  // Import all major modules to simulate full startup
  await import('../src/config/manager.js');
  await import('../src/utils/ansi.js');
  await import('../src/utils/logger.js');
  await import('../src/utils/termux.js');
  await import('../src/security/guard.js');
  await import('../src/tools/registry.js');
  await import('../src/llm/gemini.js');
  await import('../src/llm/retry.js');
  await import('../src/agent/orchestrator.js');
  await import('../src/ui/markdown.js');
  await import('../src/cli/args.js');

  // Wait for any async init to settle
  await new Promise((r) => setTimeout(r, 100));

  // Force GC if available
  if (global.gc) global.gc();

  return process.memoryUsage();
}

// -------------------------------------------------------------------
// Main benchmark runner
// -------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const iterationsArg = args.find((a) => a.startsWith('--iterations='));
  const iterations = iterationsArg ? parseInt(iterationsArg.split('=')[1], 10) : 5;

  if (!jsonMode) {
    console.log('');
    console.log(ANSI.bold(ANSI.cyan('  ⚡ Termux AI CLI — Performance Benchmark')));
    console.log(ANSI.dim(`  PRD NFR Targets: Startup < 300 ms | Memory RSS < 50 MB`));
    console.log(`  ${hr()}`);
    console.log('');
  }

  // ── 1. Startup Time ──────────────────────────────────────────────
  if (!jsonMode) {
    process.stdout.write(ANSI.dim(`  Measuring startup time (${iterations} runs)...`));
  }

  const startup = measureStartupTime(iterations);

  if (!jsonMode) {
    process.stdout.write(`\r${' '.repeat(60)}\r`);
  }

  const TARGET_STARTUP_MS = 300;
  const startupPass = startup.avg < TARGET_STARTUP_MS;

  // ── 2. Memory Footprint ───────────────────────────────────────────
  if (!jsonMode) {
    process.stdout.write(ANSI.dim('  Measuring memory footprint (module import probe)...'));
  }

  const _memResults = measureMemorySync(3);
  const mem = await measureCurrentProcessMemory();

  if (!jsonMode) {
    process.stdout.write(`\r${' '.repeat(60)}\r`);
  }

  const TARGET_MEMORY_MB = 50 * 1024 * 1024; // 50 MB in bytes
  const memoryPass = mem.rss < TARGET_MEMORY_MB;

  // ── 3. Output ─────────────────────────────────────────────────────
  if (jsonMode) {
    const report = {
      timestamp: new Date().toISOString(),
      startup: {
        avgMs: parseFloat(startup.avg.toFixed(2)),
        minMs: parseFloat(startup.min.toFixed(2)),
        maxMs: parseFloat(startup.max.toFixed(2)),
        targetMs: TARGET_STARTUP_MS,
        pass: startupPass,
      },
      memory: {
        rssMB: parseFloat((mem.rss / 1024 / 1024).toFixed(2)),
        heapUsedMB: parseFloat((mem.heapUsed / 1024 / 1024).toFixed(2)),
        heapTotalMB: parseFloat((mem.heapTotal / 1024 / 1024).toFixed(2)),
        externalMB: parseFloat((mem.external / 1024 / 1024).toFixed(2)),
        targetMB: 50,
        pass: memoryPass,
      },
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      allPass: startupPass && memoryPass,
    };
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.allPass ? 0 : 1);
  }

  // Human-readable table
  const COL1 = 30,
    COL2 = 16,
    COL3 = 16,
    COL4 = 10;
  const header = `  ${ANSI.bold(padRight('Benchmark', COL1))}${ANSI.bold(padRight('Measured', COL2))}${ANSI.bold(padRight('Target', COL3))}${ANSI.bold(padLeft('Result', COL4))}`;
  console.log(header);
  console.log(`  ${hr()}`);

  // Startup rows
  const startupRows = [
    ['Startup Time (avg)', formatMs(startup.avg), `< ${TARGET_STARTUP_MS} ms`, startupPass],
    ['Startup Time (min)', formatMs(startup.min), '—', null],
    ['Startup Time (max)', formatMs(startup.max), '—', null],
  ];

  for (const [name, measured, target, pass] of startupRows) {
    const badge = pass === null ? '' : statusBadge(pass);
    const nameColor = pass === false ? ANSI.red(padRight(name, COL1)) : padRight(name, COL1);
    console.log(`  ${nameColor}${padRight(measured, COL2)}${padRight(target, COL3)}${badge}`);
  }

  console.log(`  ${ANSI.dim(hr('·'))}`);

  // Memory rows
  const memoryRows = [
    ['Memory RSS (resident)', formatMB(mem.rss), `< 50.00 MB`, memoryPass],
    ['Memory Heap Used', formatMB(mem.heapUsed), '—', null],
    ['Memory Heap Total', formatMB(mem.heapTotal), '—', null],
    ['Memory External', formatMB(mem.external), '—', null],
  ];

  for (const [name, measured, target, pass] of memoryRows) {
    const badge = pass === null ? '' : statusBadge(pass);
    const nameColor = pass === false ? ANSI.red(padRight(name, COL1)) : padRight(name, COL1);
    console.log(`  ${nameColor}${padRight(measured, COL2)}${padRight(target, COL3)}${badge}`);
  }

  console.log(`  ${hr()}`);
  console.log('');

  // Environment
  console.log(`  ${ANSI.dim('Node.js')}  ${ANSI.cyan(process.version)}`);
  console.log(`  ${ANSI.dim('Platform')} ${ANSI.cyan(`${process.platform}/${process.arch}`)}`);
  console.log(`  ${ANSI.dim('Iterations')} ${ANSI.cyan(String(iterations))}`);
  console.log('');

  // Overall verdict
  const allPass = startupPass && memoryPass;
  if (allPass) {
    console.log(
      `  ${ANSI.bold(ANSI.green('✔ ALL BENCHMARKS PASSED'))} — termuxai meets PRD performance targets.`,
    );
  } else {
    const failures = [];
    if (!startupPass)
      failures.push(
        `Startup avg ${formatMs(startup.avg)} exceeds < ${TARGET_STARTUP_MS} ms target`,
      );
    if (!memoryPass) failures.push(`Memory RSS ${formatMB(mem.rss)} exceeds < 50 MB target`);
    console.log(`  ${ANSI.bold(ANSI.red('✘ SOME BENCHMARKS FAILED'))}`);
    for (const f of failures) {
      console.log(`    ${ANSI.red('•')} ${f}`);
    }
  }
  console.log('');

  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('Benchmark error:', err.message || err);
  process.exit(1);
});
