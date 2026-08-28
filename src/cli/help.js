/**
 * Terminal Help Screen & Version Display for Termux AI CLI
 */

import { ansi } from '../utils/ansi.js';
import { APP_NAME, APP_FULL_NAME, APP_VERSION, APP_DESCRIPTION, DEFAULT_MODEL } from '../config/constants.js';

export function showVersion() {
  console.log(
    `${ansi.bold(ansi.magenta('⚡ ' + APP_FULL_NAME))} ${ansi.cyan('v' + APP_VERSION)} ${ansi.gray('(Node ' + process.version + ')')}`
  );
}

export function showHelp() {
  console.log(`
${ansi.bold(ansi.magenta('⚡ ' + APP_FULL_NAME))} ${ansi.cyan('v' + APP_VERSION)}
${ansi.gray(APP_DESCRIPTION)}

${ansi.bold('USAGE:')}
  ${ansi.green(APP_NAME)} ${ansi.gray('[options]')} ${ansi.yellow('[prompt]')}
  ${ansi.green(APP_NAME)} ${ansi.cyan('config')} ${ansi.yellow('<set|get|list|reset>')} ${ansi.gray('[key] [value]')}
  ${ansi.green(APP_NAME)} ${ansi.cyan('resume')} ${ansi.yellow('<session-id>')}

${ansi.bold('OPTIONS:')}
  ${ansi.green('-p, --provider <id>')}     ${ansi.yellow('One-shot')} provider override ${ansi.dim('(does NOT persist — use `provider use` to persist)')}
  ${ansi.green('-m, --model <name>')}       ${ansi.yellow('One-shot')} model override ${ansi.dim(`(does NOT persist — use \`model --set\` to persist; default: ${DEFAULT_MODEL})`)}
  ${ansi.green('-k, --api-key <key>')}      Override API key for this run ${ansi.dim('(one-shot, not saved)')}
  ${ansi.green('-s, --session <id>')}       Attach to or continue a specific session ID
  ${ansi.green('-y, --yes')}                Auto-approve tool execution (skip [y/N] prompts)
  ${ansi.green('-v, --version')}            Show version number
  ${ansi.green('-h, --help')}               Show this help menu
  ${ansi.green('--verbose')}                Enable verbose debug logging
  ${ansi.green('--timeout <ms>')}           Command execution timeout in milliseconds
  ${ansi.green('--config-dir <dir>')}       Use custom configuration directory

${ansi.bold('PROVIDER COMMANDS:')}
  ${ansi.green(APP_NAME + ' provider list')}               List configured providers
  ${ansi.green(APP_NAME + ' provider use <id>')}           ${ansi.cyan('Persist')} active provider (saves to config)
  ${ansi.green(APP_NAME + ' provider add <id>')}           Interactively add a provider
  ${ansi.green(APP_NAME + ' provider remove <id>')}        Remove a custom provider
  ${ansi.green(APP_NAME + ' provider show [id]')}          Show provider config as JSON

${ansi.bold('MODEL COMMANDS:')} ${ansi.dim('(use --set / provider use to persist; --model flag is one-shot only)')}
  ${ansi.green(APP_NAME + ' model --list')}                List available models for active provider
  ${ansi.green(APP_NAME + ' model --list --all')}          List models for ALL providers
  ${ansi.green(APP_NAME + ' model --list --provider <id>')} List models for a specific provider
  ${ansi.green(APP_NAME + ' model --set <name>')}          ${ansi.cyan('Persist')} the active model (saves to config)
  ${ansi.green(APP_NAME + ' model --set <name> --provider <id>')} Set model for a specific provider
  ${ansi.green(APP_NAME + ' model --add <name[,name2,...]>')} Add model(s) to a provider's catalog (no switch)
  ${ansi.green(APP_NAME + ' model --add <names> --provider <id>')} Add to a specific provider
  ${ansi.green(APP_NAME + ' model --remove <name>')}       Remove a model from the catalog
  ${ansi.green(APP_NAME + ' model --clear [--provider <id>]')} Reset a provider's catalog to builtin defaults

${ansi.bold('CONFIG COMMANDS:')}
  ${ansi.green(APP_NAME + ' config set apiKey <val>')}   Save your Gemini API key
  ${ansi.green(APP_NAME + ' config set model <name>')}   Change default model (e.g. gemini-2.5-pro)
  ${ansi.green(APP_NAME + ' config get <key>')}          Get configuration value
  ${ansi.green(APP_NAME + ' config list')}               List all configurations
  ${ansi.green(APP_NAME + ' config reset')}              Reset configuration to defaults

${ansi.bold('CONCEPTS — One-Shot vs Persistent:')}
  ${ansi.dim('There are three "model" concepts that look similar but behave differently:')}

  ${ansi.yellow('--model <name>')}          ${ansi.dim('←')} ${ansi.red('One-shot')} — overrides for this run only, NOT saved
  ${ansi.cyan('model --set <name>')}      ${ansi.dim('←')} ${ansi.green('Persistent')} — writes to config.json, used on every next run
  ${ansi.cyan('models[]')} ${ansi.dim('(catalog)')}      ${ansi.dim('←')} List of available models shown in --list and /model picker

  ${ansi.dim('Similarly for providers:')}
  ${ansi.yellow('--provider <id>')}        ${ansi.dim('←')} ${ansi.red('One-shot')} — overrides for this run only, NOT saved
  ${ansi.cyan('provider use <id>')}      ${ansi.dim('←')} ${ansi.green('Persistent')} — writes activeProvider to config.json

  ${ansi.dim('Full guide: docs/PROVIDER_MODEL_CONCEPT.md')}

${ansi.bold('EXAMPLES:')}
  ${ansi.gray('# Start interactive REPL mode:')}
  $ ${ansi.green(APP_NAME)}

  ${ansi.gray('# Single-shot prompt execution:')}
  $ ${ansi.green(APP_NAME)} ${ansi.yellow('"buat fungsi kalkulator sederhana di math.js"')}

  ${ansi.gray('# UNIX piping analysis:')}
  $ cat error.log | ${ansi.green(APP_NAME)} ${ansi.yellow('"analisis pesan error ini"')}

  ${ansi.gray('# One-shot: run with different model (does NOT change your default):')}
  $ ${ansi.green(APP_NAME)} ${ansi.yellow('-m gemini-2.5-pro')} ${ansi.yellow('"refaktor kode ini"')}

  ${ansi.gray('# Persistent: change default model for all future runs:')}
  $ ${ansi.green(APP_NAME + ' model --set gemini-2.5-pro')}

  ${ansi.gray('# One-shot: use a different provider for this query only:')}
  $ ${ansi.green(APP_NAME)} ${ansi.yellow('--provider openai --model gpt-4o')} ${ansi.yellow('"perbaiki semua unit test"')}

  ${ansi.gray('# Manage models non-interactively from CLI:')}
  $ ${ansi.green(APP_NAME + ' model --list')}
  $ ${ansi.green(APP_NAME + ' model --list --all')}
  $ ${ansi.green(APP_NAME + ' model --set gemini-2.5-pro')}
`);
}
