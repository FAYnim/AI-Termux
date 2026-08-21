#!/usr/bin/env node

/**
 * Termux AI CLI (`t-ai` / `tai`)
 * Executable Entrypoint
 */

import { parseArgs } from '../src/cli/args.js';
import { showHelp, showVersion } from '../src/cli/help.js';
import { ConfigManager } from '../src/config/manager.js';
import { defaultSessionManager } from '../src/agent/session.js';
import { createAgentOrchestrator } from '../src/agent/orchestrator.js';
import { startRepl } from '../src/cli/repl.js';
import { runSingleShot } from '../src/cli/single-shot.js';
import { isPipedInput, readPipedStdin, mergePipedPrompt } from '../src/cli/piping.js';
import { logger } from '../src/utils/logger.js';
import { ansi } from '../src/utils/ansi.js';

async function main() {
  const parsed = parseArgs(process.argv.slice(2));

  // Initialize ConfigManager with custom directory if flag is present
  const configMgr = new ConfigManager(parsed.flags.configDir);

  // Configure logger verbosity
  if (parsed.flags.verbose) {
    logger.setVerbose(true);
  } else {
    const config = configMgr.loadConfig();
    if (config.verbose) logger.setVerbose(true);
  }

  // Handle Help & Version
  if (parsed.flags.help || parsed.command === 'help') {
    showHelp();
    process.exit(0);
  }

  if (parsed.flags.version || parsed.command === 'version') {
    showVersion();
    process.exit(0);
  }

  // Handle Config Subcommands
  if (parsed.command === 'config') {
    const sub = parsed.subcommand;
    const [key, val] = parsed.args;

    if (sub === 'list') {
      const cfg = configMgr.list({ maskApiKey: true });
      logger.info('Configuration properties:');
      console.log(JSON.stringify(cfg, null, 2));
      process.exit(0);
    }

    if (sub === 'get') {
      if (!key) {
        logger.error('Missing configuration key. Usage: t-ai config get <key>');
        process.exit(1);
      }
      const val = configMgr.get(key);
      if (val === undefined) {
        logger.warn(`Key "${key}" is not set in configuration.`);
      } else {
        const displayVal = key === 'apiKey' ? configMgr.maskApiKey(val) : val;
        console.log(displayVal);
      }
      process.exit(0);
    }

    if (sub === 'set') {
      if (!key || val === undefined) {
        logger.error('Missing key or value. Usage: t-ai config set <key> <val>');
        process.exit(1);
      }
      configMgr.set(key, val);
      logger.success(`Configuration updated: ${key} = ${key === 'apiKey' ? configMgr.maskApiKey(val) : val}`);
      process.exit(0);
    }

    if (sub === 'delete') {
      if (!key) {
        logger.error('Missing configuration key. Usage: t-ai config delete <key>');
        process.exit(1);
      }
      configMgr.delete(key);
      logger.success(`Configuration key "${key}" reset/deleted.`);
      process.exit(0);
    }

    if (sub === 'reset') {
      configMgr.reset();
      logger.success('Configuration reset to defaults.');
      process.exit(0);
    }

    logger.error(`Unknown config subcommand "${sub}". Available: get, set, list, reset, delete`);
    process.exit(1);
  }

  // Handle Session Subcommands
  if (parsed.command === 'session') {
    const sub = parsed.subcommand;
    const [sessId] = parsed.args;

    if (sub === 'list') {
      const sessions = defaultSessionManager.listSessions();
      if (sessions.length === 0) {
        logger.info('No saved sessions found.');
      } else {
        logger.info(`Found ${sessions.length} saved session(s):`);
        for (const s of sessions) {
          console.log(`  • ${ansi.yellow(s.id)} (${s.messageCount} msgs, updated: ${new Date(s.updatedAt).toLocaleString()})`);
          if (s.lastMessagePreview) {
            console.log(`    ${ansi.dim(s.lastMessagePreview)}`);
          }
        }
      }
      process.exit(0);
    }

    if (sub === 'delete') {
      if (!sessId) {
        logger.error('Missing session ID. Usage: t-ai session delete <session-id>');
        process.exit(1);
      }
      defaultSessionManager.deleteSession(sessId);
      logger.success(`Session "${sessId}" deleted.`);
      process.exit(0);
    }

    if (sub === 'clear') {
      defaultSessionManager.clearSessions();
      logger.success('All saved sessions cleared.');
      process.exit(0);
    }
  }

  // Check API Key
  const apiKey = configMgr.getApiKey(parsed.flags.apiKey);
  if (!apiKey) {
    logger.warn('Gemini API key is not configured!');
    console.log(`
${ansi.yellow('To set your API key, run:')}
  ${ansi.green('t-ai config set apiKey <your-gemini-api-key>')}

${ansi.yellow('Or export as environment variable:')}
  ${ansi.green('export GEMINI_API_KEY="your-gemini-api-key"')}

Get a free API key at: ${ansi.cyan('https://aistudio.google.com/')}
`);
    process.exit(1);
  }

  const model = parsed.flags.model || configMgr.get('model') || 'gemini-2.5-flash';
  const autoApprove = Boolean(parsed.flags.yes || configMgr.get('autoApprove'));

  // Handle Resume Session
  let activeSession = null;
  const resumeId = parsed.command === 'resume' ? parsed.subcommand : parsed.flags.session;
  if (resumeId) {
    if (defaultSessionManager.hasSession(resumeId)) {
      activeSession = defaultSessionManager.loadSession(resumeId);
      logger.info(`Resumed existing session: ${ansi.yellow(resumeId)}`);
    } else {
      logger.error(`Session "${resumeId}" not found in storage.`);
      process.exit(1);
    }
  }

  const orchestrator = createAgentOrchestrator({
    model,
    apiKey,
    session: activeSession,
    autoApprove,
    logger
  });

  // Check for UNIX piped input (e.g. cat file | t-ai "analisis")
  if (isPipedInput(process.stdin)) {
    const pipedContent = await readPipedStdin({ stream: process.stdin });
    const finalPrompt = mergePipedPrompt(pipedContent, parsed.prompt);

    if (finalPrompt) {
      const outcome = await runSingleShot(finalPrompt, {
        orchestrator,
        model,
        apiKey,
        autoApprove,
        logger
      });
      process.exit(outcome.success ? 0 : 1);
    }
  }

  // Single-shot direct prompt execution
  if (parsed.prompt) {
    const outcome = await runSingleShot(parsed.prompt, {
      orchestrator,
      model,
      apiKey,
      autoApprove,
      logger
    });
    process.exit(outcome.success ? 0 : 1);
  }

  // Interactive REPL Mode
  await startRepl({
    orchestrator,
    configMgr,
    model,
    apiKey,
    autoApprove,
    logger
  });
}

main().catch((err) => {
  logger.error(err.message || String(err));
  if (logger.isVerbose() && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
