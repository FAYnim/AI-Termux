/**
 * REPL Slash Commands Handler
 * Handles in-session commands (/help, /model, /session, /clear, /config, /exit)
 */

import { ansi } from '../utils/ansi.js';
import { renderBox, renderStatusCard } from '../ui/box.js';
import { estimateSessionTokens } from '../agent/pruner.js';

export const SLASH_COMMANDS_HELP = [
  { cmd: '/help', desc: 'Show this slash commands help menu' },
  { cmd: '/model [name]', desc: 'Show active model or switch to a new model' },
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

    case 'model': {
      const newModel = args[0];
      if (!newModel) {
        let currentModel = 'unknown';
        if (orchestrator && orchestrator.geminiClient) {
          currentModel = orchestrator.geminiClient.getModel();
        } else if (configMgr) {
          currentModel = configMgr.get('model') || 'gemini-2.5-flash';
        }
        stream.write(`\n${ansi.cyan('ℹ')} Active model: ${ansi.bold(ansi.yellow(currentModel))}\n\n`);
        return { handled: true, action: 'model_info', message: currentModel };
      }

      if (orchestrator && orchestrator.geminiClient) {
        orchestrator.geminiClient.model = newModel;
      }
      if (orchestrator && orchestrator.session) {
        orchestrator.session.model = newModel;
      }
      if (configMgr) {
        configMgr.set('model', newModel);
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
