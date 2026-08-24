/**
 * System Instructions & Environment Context Injector
 * Dynamically detects Termux / Linux environment and builds system instructions for Gemini.
 */

import os from 'node:os';
import path from 'node:path';

/**
 * Detects host and Termux-specific environment details
 *
 * @param {object} [overrides={}]
 * @returns {object}
 */
export function detectEnvironment(overrides = {}) {
  const env = overrides.env || process.env;
  const cwd = overrides.workingDir || process.cwd();

  const isTermux = Boolean(
    env.TERMUX_VERSION ||
    (env.PREFIX && env.PREFIX.includes('com.termux')) ||
    (env.HOME && env.HOME.includes('com.termux')) ||
    cwd.includes('com.termux')
  );

  const platform = overrides.platform || process.platform;
  const arch = overrides.arch || process.arch;
  const nodeVersion = overrides.nodeVersion || process.version;

  let osType = 'Linux';
  if (isTermux) {
    osType = 'Android (Termux Environment)';
  } else if (platform === 'win32') {
    osType = 'Windows';
  } else if (platform === 'darwin') {
    osType = 'macOS';
  } else if (platform === 'linux') {
    osType = 'Linux';
  }

  const now = overrides.now ? new Date(overrides.now) : new Date();

  return {
    isTermux,
    platform,
    arch,
    osType,
    nodeVersion,
    workingDir: cwd,
    homeDir: os.homedir(),
    username: env.USER || env.USERNAME || (isTermux ? 'termux' : 'user'),
    shell: env.SHELL || (platform === 'win32' ? 'powershell' : '/bin/sh'),
    datetime: now.toISOString(),
    localTime: now.toLocaleString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  };
}

/**
 * Default agent behavioral instructions
 */
export const DEFAULT_AGENT_INSTRUCTIONS = `
You are termuxai (Termux AI), an autonomous, highly capable AI assistant and software engineering agent running directly inside the user's terminal environment (optimized for Termux Android and Linux).

### OPERATIONAL GUIDELINES & REACT PARADIGM:
1. **Reasoning & Action Cycle (ReAct)**:
   - Always analyze the problem before taking action.
   - For every task, determine which tools to use, execute them, inspect the output, and proceed iteratively.
2. **File Inspection Before Modification**:
   - Inspect files using \`read_file\` or directory structure with \`list_dir\` before modifying or patching existing code.
   - Never overwrite existing files blindly unless explicitly instructed to replace them completely.
   - Use \`patch_file\` for precise, token-efficient search-and-replace edits.
   - Use \`write_file\` for creating new files or when rewriting an entire file is necessary.
3. **Verification & Self-Healing Loop**:
   - When you write or modify code, verify your changes by executing unit tests, linters, or dry-run scripts using \`execute_command\`.
   - If a tool or command returns an error or failure, carefully analyze the error output and immediately attempt a self-correcting fix in the next turn.
4. **Environment Awareness**:
   - Be mindful of resource limits in mobile/Termux environments (CPU, RAM, storage, process timeouts).
   - Write clean, modular, and dependency-light solutions where possible.
5. **Direct & Action-Oriented Output**:
   - Present final answers clearly in concise Markdown.
   - Summarize what actions were taken and what files were created or modified.
6. **Tool Invocation Requirement**:
   - You have access to local tools: \`write_file\`, \`read_file\`, \`patch_file\`, \`list_dir\`, \`execute_command\`.
   - When the user asks you to create, generate, write, or save a file (for example: "buatkan file...", "tulis file...", "create file..."), you MUST call the \`write_file\` tool with parameters \`filePath\` and \`content\`.
   - Never just return a code block in text when asked to create a file; you MUST call the tool to write it to disk.
`.trim();

/**
 * Builds the complete system instruction string for the LLM
 *
 * @param {object} [options={}]
 * @param {string} [options.customInstructions] - Custom user or project prompt
 * @param {string} [options.workingDir] - Custom working directory
 * @param {object} [options.envOverrides] - Environment overrides for testing
 * @returns {string}
 */
export function buildSystemPrompt(options = {}) {
  const envInfo = detectEnvironment({
    workingDir: options.workingDir,
    ...(options.envOverrides || {})
  });

  const parts = [];

  // Core persona & instructions
  parts.push(DEFAULT_AGENT_INSTRUCTIONS);

  // Environment context block
  parts.push(`
### ACTIVE ENVIRONMENT CONTEXT:
- **Operating System**: ${envInfo.osType} (${envInfo.platform} / ${envInfo.arch})
- **Is Termux**: ${envInfo.isTermux ? 'Yes (Native Android Shell)' : 'No (Standard Host)'}
- **Working Directory**: ${envInfo.workingDir}
- **Node.js Version**: ${envInfo.nodeVersion}
- **Shell**: ${envInfo.shell}
- **User**: ${envInfo.username}
- **Current Timestamp**: ${envInfo.datetime} (${envInfo.timezone})
`.trim());

  // Custom user / project instructions if provided
  if (options.customInstructions && typeof options.customInstructions === 'string') {
    const trimmedCustom = options.customInstructions.trim();
    if (trimmedCustom) {
      parts.push(`
### CUSTOM USER INSTRUCTIONS:
${trimmedCustom}
`.trim());
    }
  }

  return parts.join('\n\n');
}
