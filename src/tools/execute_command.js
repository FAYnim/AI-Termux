/**
 * Tool: execute_command
 * Spawns shell processes with timeout abort, real-time output capture, and truncation protection.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { DEFAULT_SECURITY_CONFIG } from '../security/rules.js';

/**
 * Executes a local shell command safely.
 *
 * @param {object} args
 * @param {string} args.command - Shell command to execute
 * @param {string} [args.workingDir] - Directory where the command will be executed
 * @param {number} [args.timeoutMs=30000] - Execution timeout in milliseconds
 * @param {object} [args.env={}] - Additional environment variables
 * @param {object} [context={}]
 * @returns {Promise<{
 *   command: string,
 *   exitCode: number,
 *   stdout: string,
 *   stderr: string,
 *   durationMs: number,
 *   timedOut: boolean,
 *   truncated: boolean
 * }>}
 */
export async function executeCommandTool(args, context = {}) {
  const { command, workingDir, timeoutMs, env = {} } = args || {};

  if (!command || typeof command !== 'string' || command.trim().length === 0) {
    throw new Error('Missing or invalid "command" argument (must be a non-empty string)');
  }

  const cwd = workingDir
    ? path.resolve(context.baseDir || process.cwd(), workingDir)
    : context.baseDir || process.cwd();

  const timeout =
    typeof timeoutMs === 'number' && timeoutMs > 0
      ? timeoutMs
      : context.defaultTimeoutMs || DEFAULT_SECURITY_CONFIG.defaultCommandTimeoutMs;

  const maxBytes = context.maxOutputSizeBytes || DEFAULT_SECURITY_CONFIG.maxOutputSizeBytes;
  const maxLines = context.maxOutputLines || DEFAULT_SECURITY_CONFIG.maxOutputLines;

  const isWindows = process.platform === 'win32';
  // SEC-02: never fall back to `shell: true` (which lets Node default to
  // %SystemRoot%\system32\cmd.exe and interpret metacharacters). Require an
  // explicit ComSpec on Windows; default to cmd.exe when missing.
  const shellOption = isWindows
    ? process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe'
    : process.env.SHELL || '/bin/sh';

  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let timedOut = false;
    let isSettled = false;

    // Spawn child process with shell
    const child = spawn(command, [], {
      cwd,
      shell: shellOption,
      env: {
        ...process.env,
        ...env,
      },
      windowsHide: true,
    });

    let timeoutTimer = null;
    if (timeout > 0) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        try {
          if (isWindows) {
            // Force kill on Windows
            child.kill('SIGTERM');
          } else {
            child.kill('SIGTERM');
            // Give brief grace period then SIGKILL
            setTimeout(() => {
              try {
                child.kill('SIGKILL');
              } catch {
                // process might have already exited
              }
            }, 500);
          }
        } catch {
          // Process already dead
        }
      }, timeout);
    }

    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString('utf-8');
    });

    child.stderr.on('data', (chunk) => {
      stderrBuffer += chunk.toString('utf-8');
    });

    const cleanup = () => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
    };

    const finish = (code) => {
      if (isSettled) return;
      isSettled = true;
      cleanup();

      const durationMs = Date.now() - startTime;
      const exitCode = timedOut ? 124 : (code ?? 0);

      let truncated = false;

      // Handle output truncation if exceeds max bytes
      if (Buffer.byteLength(stdoutBuffer, 'utf-8') > maxBytes) {
        stdoutBuffer = `${stdoutBuffer.slice(0, maxBytes)}\n... [Output truncated: maximum size limit reached]`;
        truncated = true;
      }

      if (Buffer.byteLength(stderrBuffer, 'utf-8') > maxBytes) {
        stderrBuffer = `${stderrBuffer.slice(0, maxBytes)}\n... [Output truncated: maximum size limit reached]`;
        truncated = true;
      }

      // Handle output truncation if exceeds max lines
      const stdoutLines = stdoutBuffer.split(/\r?\n/);
      if (stdoutLines.length > maxLines) {
        stdoutBuffer =
          stdoutLines.slice(0, maxLines).join('\n') +
          '\n... [Output truncated: maximum line limit reached]';
        truncated = true;
      }

      const stderrLines = stderrBuffer.split(/\r?\n/);
      if (stderrLines.length > maxLines) {
        stderrBuffer =
          stderrLines.slice(0, maxLines).join('\n') +
          '\n... [Output truncated: maximum line limit reached]';
        truncated = true;
      }

      if (timedOut) {
        const timeoutMsg = `\n[Command timed out after ${timeout} ms]`;
        stderrBuffer = stderrBuffer ? stderrBuffer + timeoutMsg : timeoutMsg.trim();
      }

      resolve({
        command,
        exitCode,
        stdout: stdoutBuffer,
        stderr: stderrBuffer,
        durationMs,
        timedOut,
        truncated,
      });
    };

    child.on('error', (err) => {
      if (isSettled) return;
      isSettled = true;
      cleanup();

      const durationMs = Date.now() - startTime;
      resolve({
        command,
        exitCode: 1,
        stdout: stdoutBuffer,
        stderr: `${stderrBuffer ? `${stderrBuffer}\n` : ''}Spawn Error: ${err.message}`,
        durationMs,
        timedOut: false,
        truncated: false,
      });
    });

    child.on('close', (code) => {
      finish(code);
    });
  });
}
