/**
 * Security Guard & Human-In-The-Loop Confirmation Engine
 */

import readline from 'node:readline';
import { configManager } from '../config/manager.js';
import { ansi } from '../utils/ansi.js';
import { validateSafePath } from './path-validator.js';
import {
  BLACKLIST_PATTERNS,
  DEFAULT_SECURITY_CONFIG,
  HARD_LIMITS,
  OBFUSCATION_PATTERNS,
  PROTECTED_PATH_PATTERNS,
  RISKY_COMMAND_PATTERNS,
} from './rules.js';

export class SecurityGuard {
  /**
   * @param {object} [options={}]
   * @param {boolean} [options.autoApprove=false] - Auto-approve risky actions (-y / --yes)
   * @param {string} [options.baseDir=process.cwd()] - Safe workspace base directory
   * @param {string[]} [options.allowedDirs=[]] - Additional explicitly allowed directories
   * @param {Function} [options.confirmationHandler=null] - Custom confirmation hook for tests/UI
   * @param {number} [options.defaultTimeoutMs=30000] - Default timeout for commands
   */
  constructor(options = {}) {
    this.autoApprove = Boolean(options.autoApprove);
    this.baseDir = options.baseDir || process.cwd();
    this.allowedDirs = Array.isArray(options.allowedDirs) ? options.allowedDirs : [];
    this.confirmationHandler = options.confirmationHandler || null;
    this.defaultTimeoutMs =
      options.defaultTimeoutMs || DEFAULT_SECURITY_CONFIG.defaultCommandTimeoutMs;
  }

  /**
   * Evaluates command safety against blacklist and risky rules
   *
   * @param {string} command
   * @returns {{ isBlacklisted: boolean, isRisky: boolean, matchedPattern?: string, rejectReason?: string }}
   */
  inspectCommand(command) {
    if (!command || typeof command !== 'string') {
      return { isBlacklisted: false, isRisky: false };
    }

    const trimmed = command.trim();

    // SEC-03: hard limits — length cap and null-byte guard.
    if (trimmed.length > HARD_LIMITS.maxCommandLength) {
      return {
        isBlacklisted: true,
        isRisky: true,
        rejectReason: `Command exceeds maximum length (${HARD_LIMITS.maxCommandLength} chars)`,
      };
    }
    if (trimmed.includes('\0')) {
      return {
        isBlacklisted: true,
        isRisky: true,
        rejectReason: 'Command contains null byte (possible truncation attack)',
      };
    }

    // SEC-03: obfuscation detection (hex escapes, base64-to-shell, eval).
    for (const pattern of OBFUSCATION_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          isBlacklisted: true,
          isRisky: true,
          matchedPattern: pattern.toString(),
          rejectReason: 'Command uses obfuscation (hex escapes / base64 / eval)',
        };
      }
    }

    // SEC-03: protected paths — any command targeting `/`, `~`, `/etc`,
    // `/boot`, `/var/lib` is rejected regardless of verb.
    for (const pattern of PROTECTED_PATH_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          isBlacklisted: true,
          isRisky: true,
          matchedPattern: pattern.toString(),
          rejectReason: 'Command targets a protected system path',
        };
      }
    }

    // Check absolute blacklist
    for (const pattern of BLACKLIST_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          isBlacklisted: true,
          isRisky: true,
          matchedPattern: pattern.toString(),
        };
      }
    }

    // Check risky patterns
    for (const pattern of RISKY_COMMAND_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          isBlacklisted: false,
          isRisky: true,
          matchedPattern: pattern.toString(),
        };
      }
    }

    return { isBlacklisted: false, isRisky: false };
  }

  /**
   * SEC-04: build path validation options, threading the opt-in flag
   * from config (`security.allowTermuxStorage`).
   */
  _pathOptions() {
    let allowTermuxStorage = false;
    try {
      allowTermuxStorage = configManager.get('security.allowTermuxStorage') === true;
    } catch {
      // config unavailable (tests) — keep default false
    }
    return {
      allowedDirs: this.allowedDirs,
      allowTermuxStorage,
    };
  }

  /**
   * Interactively prompts user for confirmation [y/N]
   *
   * @param {string} message
   * @returns {Promise<boolean>}
   */
  async promptConfirmation(message) {
    if (this.autoApprove) {
      return true;
    }

    if (typeof this.confirmationHandler === 'function') {
      return await this.confirmationHandler(message);
    }

    // Interactive CLI confirmation prompt via standard readline
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const formattedPrompt = `${ansi.bold(ansi.yellow('⚠ [SECURITY CHECK]'))} ${message} ${ansi.dim('[y/N]')}: `;

      rl.question(formattedPrompt, (answer) => {
        rl.close();
        const trimmed = (answer || '').trim().toLowerCase();
        resolve(trimmed === 'y' || trimmed === 'yes');
      });
    });
  }

  /**
   * Pre-execution validation for tool invocations
   *
   * @param {string} toolName
   * @param {object} args
   * @returns {Promise<{ allowed: boolean, reason?: string, resolvedPath?: string }>}
   */
  async authorize(toolName, args = {}) {
    switch (toolName) {
      case 'execute_command': {
        const { command, workingDir } = args;
        if (!command || typeof command !== 'string') {
          return { allowed: false, reason: 'Command must be a non-empty string.' };
        }

        const inspection = this.inspectCommand(command);

        if (inspection.isBlacklisted) {
          return {
            allowed: false,
            reason: `Forbidden command detected by security guard: "${command}" (matches blacklist pattern)`,
          };
        }

        if (workingDir) {
          const pathValidation = validateSafePath(workingDir, this.baseDir, this._pathOptions());
          if (!pathValidation.isAllowed) {
            const confirmed = await this.promptConfirmation(
              `AI wants to execute command in directory outside workspace: "${pathValidation.resolvedPath}"`,
            );
            if (!confirmed) {
              return {
                allowed: false,
                reason: `User rejected command execution in external path "${workingDir}".`,
              };
            }
          }
        }

        if (inspection.isRisky && !this.autoApprove) {
          const confirmed = await this.promptConfirmation(
            `AI wants to execute risky shell command:\n  ${ansi.cyan(command)}\nProceed?`,
          );
          if (!confirmed) {
            return {
              allowed: false,
              reason: `User denied execution of risky command: "${command}".`,
            };
          }
        }

        return { allowed: true };
      }

      case 'read_file':
      case 'write_file':
      case 'patch_file': {
        const filePath = args.filePath;
        if (!filePath || typeof filePath !== 'string') {
          return { allowed: false, reason: 'File path must be a non-empty string.' };
        }

        const pathValidation = validateSafePath(filePath, this.baseDir, this._pathOptions());

        if (!pathValidation.isAllowed && !this.autoApprove) {
          const actionVerb = toolName === 'read_file' ? 'read' : 'modify';
          const confirmed = await this.promptConfirmation(
            `AI wants to ${actionVerb} file outside workspace: "${pathValidation.resolvedPath}"`,
          );
          if (!confirmed) {
            return {
              allowed: false,
              reason: `User rejected file access outside workspace for "${filePath}".`,
            };
          }
        }

        return { allowed: true, resolvedPath: pathValidation.resolvedPath };
      }

      case 'list_dir':
      case 'grep_file':
      case 'search_files': {
        const dirPath = args.dirPath || '.';
        const pathValidation = validateSafePath(dirPath, this.baseDir, this._pathOptions());

        if (!pathValidation.isAllowed && !this.autoApprove) {
          const confirmed = await this.promptConfirmation(
            `AI wants to inspect directory outside workspace: "${pathValidation.resolvedPath}"`,
          );
          if (!confirmed) {
            return {
              allowed: false,
              reason: `User rejected directory scan outside workspace for "${dirPath}".`,
            };
          }
        }

        return { allowed: true, resolvedPath: pathValidation.resolvedPath };
      }

      case 'git_status':
      case 'git_diff': {
        if (args.workingDir && args.workingDir !== '.') {
          const pathValidation = validateSafePath(
            args.workingDir,
            this.baseDir,
            this._pathOptions(),
          );
          if (!pathValidation.isAllowed && !this.autoApprove) {
            const confirmed = await this.promptConfirmation(
              `AI wants to run git ${toolName === 'git_status' ? 'status' : 'diff'} outside workspace: "${pathValidation.resolvedPath}"`,
            );
            if (!confirmed) {
              return {
                allowed: false,
                reason: `User rejected git operation in "${args.workingDir}".`,
              };
            }
          }
        }
        return { allowed: true };
      }

      case 'git_add_commit': {
        if (args.workingDir && args.workingDir !== '.') {
          const pathValidation = validateSafePath(
            args.workingDir,
            this.baseDir,
            this._pathOptions(),
          );
          if (!pathValidation.isAllowed && !this.autoApprove) {
            const confirmed = await this.promptConfirmation(
              `AI wants to commit in directory outside workspace: "${pathValidation.resolvedPath}"`,
            );
            if (!confirmed) {
              return { allowed: false, reason: `User rejected git commit in "${args.workingDir}".` };
            }
          }
        }
        if (!this.autoApprove) {
          const confirmed = await this.promptConfirmation(
            `AI wants to stage ${(args.files || ['.']).join(', ')} and commit:\n  ${args.message}\nProceed?`,
          );
          if (!confirmed) {
            return { allowed: false, reason: 'User denied git commit.' };
          }
        }
        return { allowed: true };
      }

      default:
        return { allowed: true };
    }
  }
}
