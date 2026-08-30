#!/usr/bin/env node

/**
 * Termux AI CLI (`termuxai`) — E2E Test Runner
 *
 * Runs all End-to-End test suites and displays a formatted summary report.
 *
 * Usage:
 *   node scripts/test-e2e.js
 *   node scripts/test-e2e.js --verbose
 *   node scripts/test-e2e.js --json
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const E2E_DIR = path.join(ROOT_DIR, 'tests', 'e2e');

// ── ANSI helpers ────────────────────────────────────────────────
const A = {
  reset: '\x1b[0m',
  bold: (s) => `\x1b[1m${s}\x1b[22m`,
  green: (s) => `\x1b[32m${s}\x1b[39m`,
  red: (s) => `\x1b[31m${s}\x1b[39m`,
  yellow: (s) => `\x1b[33m${s}\x1b[39m`,
  cyan: (s) => `\x1b[36m${s}\x1b[39m`,
  blue: (s) => `\x1b[34m${s}\x1b[39m`,
  magenta: (s) => `\x1b[35m${s}\x1b[39m`,
  dim: (s) => `\x1b[2m${s}\x1b[22m`,
};

function hr(char = '─', width = 64) {
  return char.repeat(width);
}

// ── Discover E2E test files ─────────────────────────────────────
function discoverTestFiles() {
  if (!fs.existsSync(E2E_DIR)) {
    return [];
  }

  return fs
    .readdirSync(E2E_DIR)
    .filter((f) => f.endsWith('.test.js') || f.endsWith('.test.mjs'))
    .sort()
    .map((f) => path.join(E2E_DIR, f));
}

// ── Parse node:test TAP output for pass/fail counts ────────────
function parseTapOutput(output) {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let total = 0;

  const lines = output.split('\n');
  for (const line of lines) {
    const testMatch = line.match(/^# (tests|pass|fail|skipped|cancelled)\s+(\d+)/);
    if (testMatch) {
      const metric = testMatch[1];
      const count = parseInt(testMatch[2], 10);
      if (metric === 'tests') total = count;
      if (metric === 'pass') passed = count;
      if (metric === 'fail') failed = count;
      if (metric === 'skipped') skipped = count;
    }
  }

  return { total, passed, failed, skipped };
}

// ── Run a single test file ──────────────────────────────────────
function runTestFile(filePath, _verbose = false) {
  const relPath = path.relative(ROOT_DIR, filePath);
  const start = performance.now();

  const result = spawnSync(process.execPath, ['--test', filePath], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    env: {
      ...process.env,
      // Suppress color in subprocess output for cleaner parsing
      FORCE_COLOR: '0',
      NO_COLOR: '1',
    },
    timeout: 60000, // 60 second timeout per suite
  });

  const elapsed = performance.now() - start;
  const output = (result.stdout || '') + (result.stderr || '');
  const stats = parseTapOutput(output);
  const success = result.status === 0;

  return {
    filePath,
    relPath,
    success,
    elapsed,
    stats,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
    error: result.error,
  };
}

// ── Main runner ─────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose') || args.includes('-v');
  const jsonMode = args.includes('--json');

  const testFiles = discoverTestFiles();

  if (testFiles.length === 0) {
    console.error(`${A.red('✘')} No E2E test files found in: ${E2E_DIR}`);
    console.error(`  Expected files matching: tests/e2e/*.test.js`);
    process.exit(1);
  }

  if (!jsonMode) {
    console.log('');
    console.log(A.bold(A.cyan('  🧪 Termux AI CLI — E2E Integration Test Suite')));
    console.log(A.dim(`  ${testFiles.length} test suite(s) found`));
    console.log(`  ${hr()}`);
    console.log('');
  }

  const results = [];

  for (const filePath of testFiles) {
    const relPath = path.relative(ROOT_DIR, filePath);
    const suiteName = path.basename(filePath, '.test.js');

    if (!jsonMode) {
      process.stdout.write(A.dim(`  ⏳ Running ${A.bold(suiteName)}...`));
    }

    const result = runTestFile(filePath, verbose);
    results.push(result);

    if (!jsonMode) {
      process.stdout.write(`\r${' '.repeat(60)}\r`);

      const badge = result.success ? A.green('✔ PASS') : A.red('✘ FAIL');

      const stats = result.stats;
      const statsStr = `${A.green(`${stats.passed} passed`)}${stats.failed > 0 ? `, ${A.red(`${stats.failed} failed`)}` : ''}${stats.skipped > 0 ? `, ${A.yellow(`${stats.skipped} skipped`)}` : ''}`;

      const elapsedStr = A.dim(`${(result.elapsed / 1000).toFixed(2)}s`);

      console.log(`  ${badge}  ${A.bold(suiteName)}`);
      console.log(
        `        ${A.dim(relPath)} ${A.dim('|')} ${statsStr} ${A.dim('|')} ${elapsedStr}`,
      );

      if (!result.success) {
        // Show relevant error lines
        const errorLines = (result.stdout + result.stderr)
          .split('\n')
          .filter(
            (l) => l.includes('not ok') || l.includes('Error') || l.includes('AssertionError'),
          )
          .slice(0, 10);

        for (const line of errorLines) {
          console.log(`        ${A.red(A.dim(line.trim()))}`);
        }
      }

      if (verbose && result.stdout) {
        console.log('');
        console.log(
          A.dim(
            result.stdout
              .split('\n')
              .map((l) => `    ${l}`)
              .join('\n'),
          ),
        );
      }

      console.log('');
    }
  }

  // ── Summary ──────────────────────────────────────────────────
  const totalSuites = results.length;
  const passedSuites = results.filter((r) => r.success).length;
  const failedSuites = totalSuites - passedSuites;
  const totalTests = results.reduce((s, r) => s + (r.stats.total || 0), 0);
  const totalPassed = results.reduce((s, r) => s + (r.stats.passed || 0), 0);
  const totalFailed = results.reduce((s, r) => s + (r.stats.failed || 0), 0);
  const totalElapsed = results.reduce((s, r) => s + r.elapsed, 0);
  const allPassed = failedSuites === 0;

  if (jsonMode) {
    const report = {
      timestamp: new Date().toISOString(),
      suites: {
        total: totalSuites,
        passed: passedSuites,
        failed: failedSuites,
      },
      tests: {
        total: totalTests,
        passed: totalPassed,
        failed: totalFailed,
      },
      durationMs: parseFloat(totalElapsed.toFixed(2)),
      allPassed,
      results: results.map((r) => ({
        suite: path.basename(r.filePath),
        relPath: r.relPath,
        success: r.success,
        durationMs: parseFloat(r.elapsed.toFixed(2)),
        stats: r.stats,
      })),
    };
    console.log(JSON.stringify(report, null, 2));
    process.exit(allPassed ? 0 : 1);
  }

  // Human-readable summary
  console.log(`  ${hr()}`);
  console.log('');
  console.log(`  ${A.bold('Results:')}  ${passedSuites}/${totalSuites} suites passed`);
  console.log(
    `  ${A.bold('Tests:')}    ${A.green(`${totalPassed} passed`)}${totalFailed > 0 ? `, ${A.red(`${totalFailed} failed`)}` : ''}`,
  );
  console.log(`  ${A.bold('Duration:')} ${(totalElapsed / 1000).toFixed(2)}s total`);
  console.log('');

  if (allPassed) {
    console.log(
      `  ${A.bold(A.green('✔ ALL E2E TESTS PASSED'))} — Integration verified end-to-end.`,
    );
  } else {
    console.log(`  ${A.bold(A.red(`✘ ${failedSuites} SUITE(S) FAILED`))}`);
    console.log('');
    console.log(`  ${A.yellow('Failed suites:')}`);
    for (const r of results.filter((r) => !r.success)) {
      console.log(`    ${A.red('•')} ${path.basename(r.filePath)}`);
    }
    console.log('');
    console.log(`  ${A.dim('Run with --verbose for full output details.')}`);
  }
  console.log('');

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('E2E runner error:', err.message || err);
  process.exit(1);
});
