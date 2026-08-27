/**
 * Lightweight, zero-dependency CLI Argument Parser
 * Optimized for minimal latency (< 1ms)
 */

/**
 * Parse CLI arguments array (typically process.argv.slice(2))
 * @param {string[]} rawArgs
 * @returns {object}
 */
export function parseArgs(rawArgs = []) {
  const flags = {
    provider: null,
    model: null,
    apiKey: null,
    baseUrl: null,
    session: null,
    yes: false,
    help: false,
    version: false,
    verbose: false,
    configDir: null,
    timeout: null,
    // Phase 3 — `tai model` non-interactive subcommand flags
    modelList: false,  // --list    : list available models
    modelAll: false,   // --all     : when combined with --list, include all providers
    modelSet: null     // --set <m> : set active model (alternative to `--model`)
  };

  const positional = [];
  const args = [...rawArgs];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      flags.help = true;
    } else if (arg === '--version' || arg === '-v') {
      flags.version = true;
    } else if (arg === '--verbose') {
      flags.verbose = true;
    } else if (arg === '--yes' || arg === '-y') {
      flags.yes = true;
    } else if (arg.startsWith('--provider=')) {
      flags.provider = arg.slice(11).trim();
    } else if (arg === '--provider' || arg === '-p') {
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        flags.provider = args[++i].trim();
      }
    } else if (arg.startsWith('--base-url=')) {
      flags.baseUrl = arg.slice(11).trim();
    } else if (arg === '--base-url') {
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        flags.baseUrl = args[++i].trim();
      }
    } else if (arg.startsWith('--model=')) {
      flags.model = arg.slice(8).trim();
    } else if (arg === '--model' || arg === '-m') {
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        flags.model = args[++i].trim();
      }
    } else if (arg.startsWith('--api-key=')) {
      flags.apiKey = arg.slice(10).trim();
    } else if (arg === '--api-key' || arg === '-k') {
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        flags.apiKey = args[++i].trim();
      }
    } else if (arg.startsWith('--session=')) {
      flags.session = arg.slice(10).trim();
    } else if (arg === '--session' || arg === '-s') {
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        flags.session = args[++i].trim();
      }
    } else if (arg.startsWith('--config-dir=')) {
      flags.configDir = arg.slice(13).trim();
    } else if (arg === '--config-dir') {
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        flags.configDir = args[++i].trim();
      }
    } else if (arg.startsWith('--timeout=')) {
      const num = Number(arg.slice(10));
      if (!Number.isNaN(num)) flags.timeout = num;
    } else if (arg === '--timeout') {
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        const num = Number(args[++i]);
        if (!Number.isNaN(num)) flags.timeout = num;
      }
    } else if (arg === '--list') {
      // Phase 3: used by `tai model --list`
      flags.modelList = true;
    } else if (arg === '--all') {
      // Phase 3: used by `tai model --list --all` (all providers)
      flags.modelAll = true;
    } else if (arg.startsWith('--set=')) {
      // Phase 3: `tai model --set=<model>`
      const v = arg.slice(6).trim();
      if (v) flags.modelSet = v;
    } else if (arg === '--set') {
      // Phase 3: `tai model --set <model>`
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        const v = args[++i].trim();
        if (v) flags.modelSet = v;
      }
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  let command = null;
  let subcommand = null;
  let subArgs = [];
  let prompt = null;

  if (flags.help) {
    command = 'help';
  } else if (flags.version) {
    command = 'version';
  } else if (positional.length > 0) {
    const firstWord = positional[0].toLowerCase();

    if (firstWord === 'config') {
      command = 'config';
      subcommand = positional[1]?.toLowerCase() || 'list';
      subArgs = positional.slice(2);
    } else if (firstWord === 'provider' || firstWord === 'providers') {
      command = 'provider';
      subcommand = positional[1]?.toLowerCase() || 'list';
      subArgs = positional.slice(2);
    } else if (firstWord === 'session' || firstWord === 'sessions') {
      command = 'session';
      subcommand = positional[1]?.toLowerCase() || 'list';
      subArgs = positional.slice(2);
    } else if (firstWord === 'model' || firstWord === 'models') {
      // Phase 3: `tai model ...` non-interactive model management
      // Subcommands inferred from flags:
      //   --list               → list
      //   --set <m>            → set
      //   (no flags)           → list (back-compat: default to listing)
      if (flags.modelSet) {
        command = 'model';
        subcommand = 'set';
      } else {
        command = 'model';
        subcommand = 'list';
      }
      subArgs = positional.slice(2);
    } else if (firstWord === 'resume') {
      command = 'resume';
      subcommand = positional[1] || null;
      subArgs = positional.slice(2);
    } else if (firstWord === 'help') {
      command = 'help';
    } else if (firstWord === 'version') {
      command = 'version';
    } else {
      command = 'chat';
      prompt = positional.join(' ').trim();
    }
  }

  return {
    command,
    subcommand,
    args: subArgs,
    positional,
    flags,
    prompt,
    rawArgs
  };
}
