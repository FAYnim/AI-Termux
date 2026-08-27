/**
 * Phase 3 — Non-interactive `tai model ...` CLI commands
 *
 * Provides:
 *   - listModelsCli()       → for `tai model --list [--provider <id>|--all]`
 *   - setModelCli()         → for `tai model --set <model> [--provider <id>]`
 *   - handleModelCommand()  → dispatcher used by bin/tai.js
 *
 * Each function returns a result object describing what should be printed
 * and which exit code to use, so the CLI can stay a thin wrapper.
 *
 * Backward compatible: every function gracefully handles missing ConfigManager
 * (returns an error result instead of throwing).
 */

import { BUILTIN_PROVIDERS } from '../config/constants.js';
import { renderBox } from '../ui/box.js';
import { ansi } from '../utils/ansi.js';

/**
 * Get the list of providers that have a stored or builtin entry.
 * @param {object} configMgr
 * @returns {string[]}
 */
function listKnownProviders(configMgr) {
  if (!configMgr) return Object.keys(BUILTIN_PROVIDERS);
  const cfg = configMgr.loadConfig();
  const stored = Object.keys(cfg.providers || {});
  const merged = new Set([...Object.keys(BUILTIN_PROVIDERS), ...stored]);
  return Array.from(merged);
}

/**
 * Format a list of models for a given provider using a single code path so
 * the output matches the existing `/model` (no-args) REPL box.
 *
 * @param {object} options
 * @param {string} options.providerId
 * @param {boolean} [options.isActiveProvider=false]
 * @param {string|null} [options.currentModel=null]
 * @param {object} [options.configMgr]
 * @returns {string[]} lines (without trailing newline)
 */
function formatProviderModels({ providerId, isActiveProvider = false, currentModel = null, configMgr = null }) {
  const builtin = BUILTIN_PROVIDERS[providerId];
  const models = configMgr?.getProviderModels
    ? configMgr.getProviderModels(providerId)
    : (builtin?.models || [builtin?.defaultModel].filter(Boolean));

  if (!Array.isArray(models) || models.length === 0) {
    return [`  ${ansi.dim('(no models registered)')}`];
  }

  return models.map((m) => {
    const isActive = isActiveProvider && m === currentModel;
    const marker = isActive ? ansi.yellow(ansi.bold('▸')) : ' ';
    const tag = isActive ? ` ${ansi.yellow(ansi.bold('(active)'))}` : '';
    return `  ${marker} ${ansi.cyan(m)}${tag}`;
  });
}

/**
 * List available models. Mirrors `/model` (no-args) but for the terminal.
 *
 * @param {object} options
 * @param {object} options.configMgr
 * @param {boolean} [options.all=false]      include every provider, not just active
 * @param {string} [options.providerOverride=null] explicit provider id
 * @returns {{ exitCode: number, output: string|null }}
 */
export function listModelsCli({ configMgr, all = false, providerOverride = null } = {}) {
  if (!configMgr) {
    return { exitCode: 1, output: null, error: 'ConfigManager unavailable' };
  }

  const activeProvider = configMgr.get('activeProvider') || 'gemini';
  const targetProvider = providerOverride || activeProvider;
  let currentModel = '';
  try {
    currentModel = configMgr.getProviderConfig?.(targetProvider)?.model
      || BUILTIN_PROVIDERS[targetProvider]?.defaultModel
      || '';
  } catch (_) {
    // getProviderConfig throws on unknown providers; we validate below.
    currentModel = '';
  }

  // Validate the explicit provider, if any
  if (providerOverride && !BUILTIN_PROVIDERS[providerOverride] && !configMgr.get('providers.' + providerOverride)) {
    return {
      exitCode: 1,
      output: `${ansi.red('✖')} Unknown provider: ${ansi.yellow(providerOverride)}\n`
    };
  }

  if (all) {
    // Group by all known providers
    const known = listKnownProviders(configMgr);
    const sections = [];
    for (const pid of known) {
      const isActive = pid === activeProvider;
      const headerSuffix = isActive ? ` ${ansi.dim('(active)')}` : '';
      sections.push(`${ansi.bold(ansi.magenta(pid))}${headerSuffix}`);
      sections.push(...formatProviderModels({
        providerId: pid,
        isActiveProvider: isActive,
        currentModel: pid === activeProvider ? currentModel : null,
        configMgr
      }));
      sections.push('');
    }
    const box = renderBox(sections.join('\n').trimEnd(), {
      title: `Models — All Providers (${known.length})`,
      borderStyle: 'round',
      borderColor: 'cyan',
      minWidth: 40
    });
    return { exitCode: 0, output: `\n${box}\n` };
  }

  // Single-provider view (default)
  const models = configMgr.getProviderModels?.(targetProvider)
    || BUILTIN_PROVIDERS[targetProvider]?.models
    || [];

  const lines = formatProviderModels({
    providerId: targetProvider,
    isActiveProvider: targetProvider === activeProvider,
    currentModel,
    configMgr
  });

  // Optional: show "other providers" snapshot when not in --all mode
  const otherProviders = listKnownProviders(configMgr).filter(p => p !== targetProvider);
  if (otherProviders.length > 0) {
    lines.push('');
    lines.push(ansi.dim('  Other providers:'));
    for (const pid of otherProviders) {
      const ms = configMgr.getProviderModels?.(pid) || BUILTIN_PROVIDERS[pid]?.models || [];
      const sample = ms.slice(0, 4).join(', ');
      const more = ms.length > 4 ? ansi.dim(`, +${ms.length - 4} more`) : '';
      lines.push(`  ${ansi.dim('•')} ${ansi.cyan(pid)}: ${ansi.white(sample)}${more}`);
    }
  }

  const box = renderBox(lines.join('\n'), {
    title: `Model (${targetProvider})`,
    borderStyle: 'round',
    borderColor: 'cyan',
    minWidth: 36
  });
  return { exitCode: 0, output: `\n${box}\n`, currentModel, models };
}

/**
 * Set the active model for a provider and persist.
 *
 * @param {object} options
 * @param {object} options.configMgr
 * @param {string} options.model          model name (required)
 * @param {string} [options.providerOverride=null] provider id (defaults to activeProvider)
 * @returns {{ exitCode: number, output: string|null }}
 */
export function setModelCli({ configMgr, model, providerOverride = null } = {}) {
  if (!configMgr) {
    return { exitCode: 1, output: null, error: 'ConfigManager unavailable' };
  }
  if (!model || typeof model !== 'string' || !model.trim()) {
    return {
      exitCode: 1,
      output: `${ansi.red('✖')} Missing model name. Usage: termuxai model --set <model> [--provider <id>]\n`
    };
  }

  const target = providerOverride || configMgr.get('activeProvider') || 'gemini';
  const builtin = BUILTIN_PROVIDERS[target];

  // Persist via setProviderField — auto-populates models[] on first use
  configMgr.setProviderField(target, 'model', model.trim());

  // If the user is updating the *active* provider, also flip activeProvider
  if (!providerOverride) {
    configMgr.set('activeProvider', target);
  }

  const isBuiltin = Boolean(builtin);
  const knownModels = configMgr.getProviderModels?.(target) || [];
  const inCatalog = knownModels.includes(model.trim());
  const note = !isBuiltin
    ? ` ${ansi.dim('(custom provider)')}`
    : !inCatalog
      ? ` ${ansi.dim('(not in builtin catalog — saved as custom)')}`
      : '';

  return {
    exitCode: 0,
    output: `\n${ansi.green('✔')} Active model set to: ${ansi.bold(ansi.yellow(model.trim()))} ${ansi.dim(`[${target}]`)}${note}\n`,
    provider: target,
    model: model.trim(),
    inCatalog
  };
}

/**
 * Dispatcher for `tai model ...`. Called by bin/tai.js.
 *
 * @param {object} parsed - result of parseArgs()
 * @param {object} configMgr
 * @returns {{ exitCode: number, output: string|null }}
 */
export function handleModelCommand(parsed, configMgr) {
  const sub = parsed?.subcommand;

  if (sub === 'list' || (sub === null && parsed?.flags?.modelList)) {
    return listModelsCli({
      configMgr,
      all: Boolean(parsed?.flags?.modelAll),
      providerOverride: parsed?.flags?.provider || null
    });
  }

  if (sub === 'set' || parsed?.flags?.modelSet) {
    return setModelCli({
      configMgr,
      model: parsed?.flags?.modelSet,
      providerOverride: parsed?.flags?.provider || null
    });
  }

  // Fallback: no recognized subcommand → list
  return listModelsCli({
    configMgr,
    all: Boolean(parsed?.flags?.modelAll),
    providerOverride: parsed?.flags?.provider || null
  });
}
