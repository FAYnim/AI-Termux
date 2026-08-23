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
  ${ansi.green('-p, --provider <id>')}     One-shot provider override (does not persist)
  ${ansi.green('-m, --model <name>')}       Set LLM model ${ansi.gray(`(default: ${DEFAULT_MODEL})`)}
  ${ansi.green('-k, --api-key <key>')}      Override API key for this run
  ${ansi.green('-s, --session <id>')}       Attach to or continue a specific session ID
  ${ansi.green('-y, --yes')}                Auto-approve tool execution (skip [y/N] prompts)
  ${ansi.green('-v, --version')}            Show version number
  ${ansi.green('-h, --help')}               Show this help menu
  ${ansi.green('--verbose')}                Enable verbose debug logging
  ${ansi.green('--timeout <ms>')}           Command execution timeout in milliseconds
  ${ansi.green('--config-dir <dir>')}       Use custom configuration directory

${ansi.bold('PROVIDER COMMANDS:')}
  ${ansi.green(APP_NAME + ' provider list')}               List configured providers
  ${ansi.green(APP_NAME + ' provider use <id>')}           Set active provider (persist)
  ${ansi.green(APP_NAME + ' provider add <id>')}           Interactively add a provider
  ${ansi.green(APP_NAME + ' provider remove <id>')}        Remove a custom provider
  ${ansi.green(APP_NAME + ' provider show [id]')}          Show provider config as JSON

${ansi.bold('CONFIG COMMANDS:')}
  ${ansi.green(APP_NAME + ' config set apiKey <val>')}   Save your Gemini API key
  ${ansi.green(APP_NAME + ' config set model <name>')}   Change default model (e.g. gemini-2.5-pro)
  ${ansi.green(APP_NAME + ' config get <key>')}          Get configuration value
  ${ansi.green(APP_NAME + ' config list')}               List all configurations
  ${ansi.green(APP_NAME + ' config reset')}              Reset configuration to defaults

${ansi.bold('EXAMPLES:')}
  ${ansi.gray('# Start interactive REPL mode:')}
  $ ${ansi.green(APP_NAME)}

  ${ansi.gray('# Single-shot prompt execution:')}
  $ ${ansi.green(APP_NAME)} ${ansi.yellow('"buat fungsi kalkulator sederhana di math.js"')}

  ${ansi.gray('# UNIX piping analysis:')}
  $ cat error.log | ${ansi.green(APP_NAME)} ${ansi.yellow('"analisis pesan error ini"')}

  ${ansi.gray('# Run with custom model & auto-approval:')}
  $ ${ansi.green(APP_NAME)} ${ansi.green('-m gemini-2.5-pro -y')} ${ansi.yellow('"perbaiki semua unit test"')}
`);
}
