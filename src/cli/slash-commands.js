/**
 * REPL Slash Commands Handler
 * Handles in-session commands (/help, /model, /session, /clear, /config, /exit)
 */

import { ansi } from '../utils/ansi.js';
import { renderBox, renderStatusCard } from '../ui/box.js';
import { showModelMenuFromConfig } from '../ui/model-menu.js';
import { estimateSessionTokens } from '../agent/pruner.js';

export const SLASH_COMMANDS_HELP = [
  { cmd: '/help', desc: 'Show this slash commands help menu' },
  { cmd: '/provider [id]', desc: 'Show active provider or switch provider + persist' },
  { cmd: '/provider list', desc: 'List configured providers' },
  { cmd: '/model [name]', desc: 'Show available models (interactive TTY menu) or switch to a new model' },
  { cmd: '/session', desc: 'Display current session ID, token usage & stats' },
  { cmd: '/clear', desc: 'Clear the terminal screen' },
  { cmd: '/config', desc: 'Display active CLI configuration settings' },
  { cmd: '/exit, /quit', desc: 'Exit interactive REPL session' }
];

/**
 * Determines if user input is a slash command
 * @param {string} input
 * @returns {boolean}
 */
export function isSlashCommand(input) {
  if (!input || typeof input !== 'string') return false;
  return input.trim().startsWith('/');
}

/**
 * Parses and executes a slash command
 *
 * @param {string} input - Raw command line starting with '/'
 * @param {object} context - Execution context
 * @param {import('../agent/orchestrator.js').AgentOrchestrator} [context.orchestrator]
 * @param {import('../config/manager.js').ConfigManager} [context.configMgr]
 * @param {import('../utils/logger.js').logger} [context.logger]
 * @param {NodeJS.WriteStream} [context.stream=process.stdout]
 * @param {NodeJS.ReadableStream} [context.input=process.stdin]
 * @returns {Promise<{ handled: boolean, action?: string, message?: string, error?: boolean }>}
 */
export async function executeSlashCommand(input, context = {}) {
  if (!isSlashCommand(input)) {
    return { handled: false };
  }

  const parts = input.trim().slice(1).split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);
  const stream = context.stream || process.stdout;
  const configMgr = context.configMgr;
  const orchestrator = context.orchestrator;
  const inputStream = context.input || process.stdin;

  switch (command) {
    case 'help': {
      const lines = SLASH_COMMANDS_HELP.map(
        c => `${ansi.cyanBright(c.cmd.padEnd(16))} ${ansi.dim('─')} ${ansi.white(c.desc)}`
      );
      const box = renderBox(lines.join('\n'), {
        title: 'REPL Slash Commands',
        borderColor: 'cyan',
        borderStyle: 'round',
        minWidth: 48
      });
      stream.write(`\n${box}\n\n`);
      return { handled: true, action: 'help' };
    }

    case 'provider': {
      const action = args[0];
      if (action === 'list') {
        const config = configMgr ? configMgr.loadConfig() : {};
        const providers = config.providers || {};
        const lines = Object.entries(providers).map(([id, cfg]) =>
          `  ${ansi.cyan(id.padEnd(12))} ${ansi.dim('|')} ${ansi.white(cfg.model || '(default)')} ${ansi.dim('|')} ${ansi.white(cfg.baseUrl || '(default)')}`
        );
        if (!lines.length) lines.push(ansi.dim('  (no providers configured)'));
        const box = renderBox(lines.join('\n'), {
          title: 'Providers',
          borderColor: 'cyan',
          borderStyle: 'round',
          minWidth: 48
        });
        stream.write(`\n${box}\n\n`);
        return { handled: true, action: 'provider_list' };
      }

      const providerId = action;
      if (!providerId) {
        const active = (orchestrator && orchestrator.provider) || configMgr?.get('activeProvider') || 'gemini';
        stream.write(`\n${ansi.cyan('ℹ')} Active provider: ${ansi.bold(ansi.yellow(active))}\n\n`);
        return { handled: true, action: 'provider_info' };
      }

      if (orchestrator && typeof orchestrator.setProvider === 'function') {
        try {
          const providerConfig = configMgr ? configMgr.getProviderConfig(providerId) : {};
          const apiKey = configMgr ? configMgr.getApiKey(null, providerId) : null;
          orchestrator.setProvider(providerId, {
            apiKey,
            model: providerConfig.model || providerConfig.defaultModel,
            baseUrl: providerConfig.baseUrl || providerConfig.defaultBaseUrl
          });
          if (configMgr) configMgr.set('activeProvider', providerId);
          stream.write(`\n${ansi.green('✔')} Switched provider to: ${ansi.bold(ansi.yellow(providerId))}\n\n`);
          return { handled: true, action: 'provider_changed' };
        } catch (err) {
          stream.write(`\n${ansi.yellow('⚠')} ${err.message}\n\n`);
          return { handled: true, action: 'provider_error', error: true };
        }
      }

      stream.write(`\n${ansi.yellow('⚠')} No orchestrator context for /provider.\n\n`);
      return { handled: true, action: 'provider_error', error: true };
    }

    case 'model': {
      const newModel = args[0];
      if (!newModel) {
        let currentModel = 'unknown';
        const client = orchestrator?.llmClient || orchestrator?.geminiClient;
        if (client && typeof client.getModel === 'function') {
          currentModel = client.getModel();
        } else if (configMgr) {
          const act = configMgr.get('activeProvider') || 'gemini';
          try {
            currentModel = configMgr.getProviderConfig(act).model || 'gemini-2.5-flash';
          } catch {
            currentModel = 'gemini-2.5-flash';
          }
        }

        // Phase 2: If we're attached to a TTY, show interactive menu first.
        // The text box (Phase 1.3) is still rendered afterwards as a reference
        // for any TTY fallbacks (e.g. menu with no items).
        const isInteractiveTty = Boolean(
          stream && stream.isTTY &&
          (typeof stream === 'object') &&
          inputStream && inputStream.isTTY
        );

        if (isInteractiveTty && configMgr && typeof configMgr.getProviderModels === 'function') {
          const menuResult = await showModelMenuFromConfig({
            configMgr,
            orchestrator,
            input: inputStream,
            output: stream
          });

          if (!menuResult.cancelled) {
            // Apply the selection through the same code path as `/model <name>`
            const chosen = menuResult.model;
            if (orchestrator) {
              if (orchestrator.llmClient) {
                if (typeof orchestrator.llmClient.setModel === 'function') {
                  orchestrator.llmClient.setModel(chosen);
                } else {
                  orchestrator.llmClient.model = chosen;
                }
              }
              if (orchestrator.geminiClient) {
                if (typeof orchestrator.geminiClient.setModel === 'function') {
                  orchestrator.geminiClient.setModel(chosen);
                } else {
                  orchestrator.geminiClient.model = chosen;
                }
              }
              if (orchestrator.session) {
                orchestrator.session.model = chosen;
              }
            }
            if (configMgr) {
              const act = (orchestrator && orchestrator.provider) || configMgr.get('activeProvider') || 'gemini';
              configMgr.setProviderField(act, 'model', chosen);
            }
            const providerLabel = menuResult.providerId !== ((orchestrator && orchestrator.provider) || configMgr.get('activeProvider'))
              ? ` (provider: ${ansi.bold(ansi.yellow(menuResult.providerId))})`
              : '';
            stream.write(`\n${ansi.green('✔')} Switched active model to: ${ansi.bold(ansi.yellow(chosen))}${providerLabel}\n\n`);
            return { handled: true, action: 'model_changed', message: chosen };
          }

          // User cancelled the interactive menu → fall through to the static box
        }

        // Phase 1.3: Render box with available models for active provider
        let modelLines = [];
        if (configMgr && typeof configMgr.getProviderModels === 'function') {
          const act = (orchestrator && orchestrator.provider) || configMgr.get('activeProvider') || 'gemini';
          const allModels = configMgr.getProviderModels(act);
          if (allModels.length > 0) {
            modelLines = allModels.map((m) =>
              m === currentModel
                ? `  ${ansi.green('▸')} ${ansi.bold(ansi.yellow(m))} ${ansi.dim('(active)')}`
                : `    ${ansi.white(m)}`
            );

            // Show other providers' models in a second section
            const stored = configMgr.loadConfig().providers || {};
            const otherIds = Object.keys(stored).filter((pid) => pid !== act);
            if (otherIds.length > 0) {
              const otherLines = [];
              for (const pid of otherIds) {
                const pm = configMgr.getProviderModels(pid);
                if (pm.length > 0) {
                  otherLines.push(`  ${ansi.cyan(pid + ':')} ${pm.join(', ')}`);
                }
              }
              if (otherLines.length > 0) {
                modelLines.push('');
                modelLines.push(ansi.dim('  Other providers:'));
                modelLines.push(...otherLines);
              }
            }

            const box = renderBox(modelLines.join('\n'), {
              title: `Model (${act})`,
              borderColor: 'cyan',
              borderStyle: 'round',
              minWidth: 48
            });
            stream.write(`\n${box}\n\n`);
            return { handled: true, action: 'model_info', message: currentModel };
          }
        }

        // Fallback: original single-line output (no getProviderModels or empty list)
        stream.write(`\n${ansi.cyan('ℹ')} Active model: ${ansi.bold(ansi.yellow(currentModel))}\n\n`);
        return { handled: true, action: 'model_info', message: currentModel };
      }

      if (orchestrator) {
        if (orchestrator.llmClient) {
          if (typeof orchestrator.llmClient.setModel === 'function') {
            orchestrator.llmClient.setModel(newModel);
          } else {
            orchestrator.llmClient.model = newModel;
          }
        }
        if (orchestrator.geminiClient) {
          if (typeof orchestrator.geminiClient.setModel === 'function') {
            orchestrator.geminiClient.setModel(newModel);
          } else {
            orchestrator.geminiClient.model = newModel;
          }
        }
        if (orchestrator.session) {
          orchestrator.session.model = newModel;
        }
      }
      if (configMgr) {
        const act = (orchestrator && orchestrator.provider) || configMgr.get('activeProvider') || 'gemini';
        configMgr.setProviderField(act, 'model', newModel);
      }
      stream.write(`\n${ansi.green('✔')} Switched active model to: ${ansi.bold(ansi.yellow(newModel))}\n\n`);
      return { handled: true, action: 'model_changed', message: newModel };
    }

    case 'session': {
      if (!orchestrator || !orchestrator.session) {
        stream.write(`\n${ansi.yellow('⚠')} No active session context found.\n\n`);
        return { handled: true, action: 'session_info', error: true };
      }

      const sess = orchestrator.session;
      const msgs = sess.getMessages ? sess.getMessages() : [];
      const tokenEst = estimateSessionTokens ? estimateSessionTokens(sess) : 0;

      const card = renderStatusCard('Active Session Details', {
        'Session ID': sess.id || 'N/A',
        'Model': (orchestrator.geminiClient && orchestrator.geminiClient.getModel()) || sess.model || 'N/A',
        'Working Dir': sess.workingDir || process.cwd(),
        'Message Turns': msgs.length,
        'Est. Tokens': `${tokenEst.toLocaleString()} tokens`,
        'Created At': sess.createdAt ? new Date(sess.createdAt).toLocaleString() : 'N/A'
      });

      stream.write(`\n${card}\n\n`);
      return { handled: true, action: 'session_info' };
    }

    case 'clear': {
      if (typeof console.clear === 'function') {
        console.clear();
      } else {
        stream.write('\x1b[2J\x1b[0f');
      }
      return { handled: true, action: 'clear' };
    }

    case 'config': {
      const cfg = configMgr ? configMgr.list({ maskApiKey: true }) : {};
      const card = renderStatusCard('Configuration Settings', cfg);
      stream.write(`\n${card}\n\n`);
      return { handled: true, action: 'config_info' };
    }

    case 'exit':
    case 'quit': {
      stream.write(`\n${ansi.cyan('👋 Goodbye! Session saved.')}\n\n`);
      return { handled: true, action: 'exit' };
    }

    default: {
      const errMsg = `Unknown slash command: "/${command}". Type ${ansi.cyan('/help')} for a list of available commands.`;
      stream.write(`\n${ansi.yellow('⚠')} ${errMsg}\n\n`);
      return { handled: true, action: 'unknown', error: true, message: errMsg };
    }
  }
}
