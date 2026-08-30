/**
 * Interactive REPL Session Engine
 * Multi-turn terminal interface with slash commands and SIGINT handling.
 */

import readline from 'node:readline';
import { AgentOrchestrator, createAgentOrchestrator } from '../agent/orchestrator.js';
import { contextBudgetLimit, getContextTokens, getUsage } from '../agent/usage.js';
import { APP_NAME } from '../config/constants.js';
import { ConfigManager } from '../config/manager.js';
import { loadLocale, t } from '../i18n/index.js';
import { renderBanner, renderStatusLine } from '../ui/box.js';
import { renderMarkdown } from '../ui/markdown.js';
import { createSpinner } from '../ui/spinner.js';
import { ansi } from '../utils/ansi.js';
import { logger as defaultLogger } from '../utils/logger.js';
import { executeSlashCommand, isSlashCommand } from './slash-commands.js';

export const REPL_PROMPT = `${ansi.cyan(APP_NAME)} ${ansi.bold('❯')} `;

/**
 * Starts the Interactive REPL Session Loop
 *
 * @param {object} [options={}]
 * @param {AgentOrchestrator} [options.orchestrator]
 * @param {ConfigManager} [options.configMgr]
 * @param {string} [options.model]
 * @param {string} [options.apiKey]
 * @param {string} [options.workingDir]
 * @param {boolean} [options.autoApprove=false]
 * @param {NodeJS.ReadableStream} [options.input=process.stdin]
 * @param {NodeJS.WritableStream} [options.output=process.stdout]
 * @param {object} [options.logger]
 * @returns {Promise<void>}
 */
export async function startRepl(options = {}) {
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  const logger = options.logger || defaultLogger;
  const configMgr = options.configMgr || new ConfigManager();
  await loadLocale(configMgr.get('locale'));

  const orchestrator =
    options.orchestrator ||
    createAgentOrchestrator({
      model: options.model || configMgr.get('model'),
      apiKey: options.apiKey || configMgr.getApiKey(),
      workingDir: options.workingDir || process.cwd(),
      autoApprove: options.autoApprove,
      logger,
    });

  const session = orchestrator.getSession();
  const activeModel = orchestrator.llmClient
    ? orchestrator.llmClient.getModel()
    : 'gemini-2.5-flash';
  const activeProvider = orchestrator.provider || 'gemini';

  // Display Welcome Banner
  const banner = renderBanner({
    title: '⚡ termux-ai-cli',
    version: 'v1.0.0',
    subtitle: 'Autonomous AI Agent CLI for Termux Android',
    details: [
      `Provider: ${ansi.bold(ansi.green(activeProvider))}`,
      `Model   : ${ansi.bold(ansi.cyan(activeModel))}`,
      `Session : ${ansi.bold(ansi.yellow(session.id))}`,
      `WorkDir : ${ansi.dim(orchestrator.workingDir)}`,
      `Commands: Type ${ansi.cyan('/help')} for menu or ${ansi.cyan('/exit')} to quit`,
    ],
  });

  output.write(`\n${banner}\n\n`);

  const rl = readline.createInterface({
    input,
    output,
    prompt: REPL_PROMPT,
    terminal: Boolean(output.isTTY),
  });

  let isBusy = false;
  let activeAbortController = null;
  let lastSigintTime = 0;
  let isClosing = false;
  let _wizardActive = false; // true while a sub-readline wizard owns stdin
  let lastIterations = 0;

  // Handle SIGINT (Ctrl+C)
  rl.on('SIGINT', () => {
    if (isBusy && activeAbortController) {
      output.write(`\n${ansi.yellow(t('cancelled'))}\n`);
      activeAbortController.abort();
      return;
    }

    // Remove early return for wizardActive – Ctrl+C should always trigger REPL exit flow.

    const now = Date.now();
    if (now - lastSigintTime < 1000) {
      output.write(`\n${ansi.cyan(t('goodbye'))}\n\n`);
      isClosing = true;
      rl.close();
      return;
    }

    lastSigintTime = now;
    output.write(`\n${ansi.dim(t('ctrlCExitHint'))}\n`);
    rl.prompt();
  });

  // Prompt reader helper
  const askQuestion = () => {
    return new Promise((resolve) => {
      if (isClosing) {
        resolve(null);
        return;
      }
      rl.question(REPL_PROMPT, (answer) => {
        resolve(answer);
      });
    });
  };

  // Prints the one-line session status (tokens · context · loops) that the
  // user sees above every new prompt. Reads fresh session state so it is
  // correct on success, error, and abort paths alike.
  const printStatusLine = () => {
    const sess = orchestrator.getSession();
    output.write(
      `\n${renderStatusLine({
        usage: getUsage(sess),
        contextTokens: getContextTokens(sess),
        contextBudget: contextBudgetLimit(orchestrator.maxContextTokens),
        iterations: lastIterations,
        maxIterations: orchestrator.maxIterations,
      })}\n`,
    );
  };

  // Main REPL Event Loop
  while (!isClosing) {
    const rawInput = await askQuestion();
    if (rawInput === null || isClosing) {
      break;
    }

    const line = (rawInput || '').trim();
    if (!line) {
      continue;
    }

    // Intercept Slash Commands
    if (isSlashCommand(line)) {
      // Pause the outer REPL readline so the wizard (a child readline on
      // the same input stream) can read raw ESC bytes without them leaking
      // back to the REPL and being interpreted as SIGINT/exit.
      if (typeof rl.pause === 'function') rl.pause();
      const slashResult = await executeSlashCommand(line, {
        orchestrator,
        configMgr,
        logger,
        stream: output,
        input,
        onWizardActive: (active) => {
          _wizardActive = active;
        },
      });
      // Resume the REPL readline and force a fresh prompt so any stale
      // buffer is cleared before the user types the next line.
      if (typeof rl.resume === 'function') rl.resume();

      if (slashResult.action === 'exit') {
        isClosing = true;
        rl.close();
        break;
      }
      continue;
    }

    // Process Agent Turn
    isBusy = true;
    activeAbortController = new AbortController();
    const spinner = createSpinner({ stream: output });
    let hasStreamedToken = false;

    try {
      const providerName = orchestrator.provider ? orchestrator.provider.toUpperCase() : 'LLM';
      spinner.start(t('contactingApi', { provider: providerName }));

      const result = await orchestrator.runTurn(line, {
        signal: activeAbortController.signal,
        onIterationStart: (iter) => {
          lastIterations = iter;
          if (iter > 1) {
            hasStreamedToken = false;
            spinner.start(t('thinkingTurn', { turn: iter }));
          }
        },
        onToken: (token) => {
          const clean = token.replace(
            /<\/?(?:think|tool_calls?|function_call|tool_sep)[^>]*>/gi,
            '',
          );
          if (!clean) return;

          if (spinner.isSpinning()) {
            spinner.stop();
          }
          if (!hasStreamedToken) {
            hasStreamedToken = true;
            output.write('\n');
          }
          output.write(clean);
        },
        onToolCall: (call) => {
          if (spinner.isSpinning()) {
            spinner.stop();
          }
          const argsStr = JSON.stringify(call.args || {}).slice(0, 50);
          output.write(
            `\n${ansi.magenta('⚡ [TOOL]')} ${ansi.bold(call.name)} ${ansi.dim(argsStr)}\n`,
          );
          spinner.start(t('runningTool', { tool: call.name }));
        },
        onToolResult: (name, toolRes) => {
          if (toolRes?.error) {
            spinner.warn(t('toolError', { tool: name, message: toolRes.message || t('failed') }));
          } else {
            spinner.succeed(t('toolDone', { tool: name }));
          }
          spinner.start(t('analyzingResult'));
        },
      });

      if (spinner.isSpinning()) {
        spinner.stop();
      }

      if (!hasStreamedToken && result.text) {
        output.write(`\n${renderMarkdown(result.text)}\n\n`);
      } else {
        output.write('\n\n');
      }
    } catch (err) {
      if (spinner.isSpinning()) {
        spinner.stop();
      }

      if (activeAbortController?.signal.aborted) {
        // Handled in SIGINT handler
      } else {
        logger.error(`Turn execution failed: ${err.message}`);
        output.write('\n');
      }
    } finally {
      isBusy = false;
      activeAbortController = null;
    }
    printStatusLine();
  }
}
