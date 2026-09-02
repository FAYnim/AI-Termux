/**
 * Phase 3 — Non-interactive `faycli model ...` CLI commands
 *
 * Provides:
 *   - listModelsCli()       → for `faycli model --list [--provider <id>|--all]`
 *   - setModelCli()         → for `faycli model --set <model> [--provider <id>]`
 *   - handleModelCommand()  → dispatcher used by bin/faycli.js
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
 *
 * Delegates to `configMgr.getProviderNames()` (Phase 1.3 single source of
 * truth) when available, so custom providers are always included.
 *
 * @param {object} configMgr
 * @returns {string[]}
 */
function listKnownProviders(configMgr) {
  if (configMgr && typeof configMgr.getProviderNames === 'function') {
    return configMgr.getProviderNames();
  }
  // Fallback when configMgr is unavailable (e.g. tests that don't pass one)
  return Object.keys(BUILTIN_PROVIDERS);
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
function formatProviderModels({
  providerId,
  isActiveProvider = false,
  currentModel = null,
  configMgr = null,
}) {
  const builtin = BUILTIN_PROVIDERS[providerId];
  // Phase 2.2: prefer getModelCatalog() (canonical getter) over deprecated getProviderModels()
  const models = configMgr?.getModelCatalog
    ? configMgr.getModelCatalog(providerId)
    : builtin?.models || [builtin?.defaultModel].filter(Boolean);

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
    // Phase 2.2: use getActiveModel() instead of getProviderConfig().model
    currentModel =
      configMgr.getActiveModel?.(targetProvider) ||
      BUILTIN_PROVIDERS[targetProvider]?.defaultModel ||
      '';
  } catch (_) {
    currentModel = '';
  }

  // Validate the explicit provider, if any
  if (
    providerOverride &&
    !BUILTIN_PROVIDERS[providerOverride] &&
    !configMgr.get(`providers.${providerOverride}`)
  ) {
    return {
      exitCode: 1,
      output: `${ansi.red('✖')} Unknown provider: ${ansi.yellow(providerOverride)}\n`,
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
      sections.push(
        ...formatProviderModels({
          providerId: pid,
          isActiveProvider: isActive,
          currentModel: pid === activeProvider ? currentModel : null,
          configMgr,
        }),
      );
      sections.push('');
    }
    const box = renderBox(sections.join('\n').trimEnd(), {
      title: `Models — All Providers (${known.length})`,
      borderStyle: 'round',
      borderColor: 'cyan',
      minWidth: 40,
    });
    return { exitCode: 0, output: `\n${box}\n` };
  }

  // Single-provider view (default)
  // Phase 2.2: prefer getModelCatalog() over deprecated getProviderModels()
  const models =
    configMgr.getModelCatalog?.(targetProvider) || BUILTIN_PROVIDERS[targetProvider]?.models || [];

  const lines = formatProviderModels({
    providerId: targetProvider,
    isActiveProvider: targetProvider === activeProvider,
    currentModel,
    configMgr,
  });

  // Optional: show "other providers" snapshot when not in --all mode
  const otherProviders = listKnownProviders(configMgr).filter((p) => p !== targetProvider);
  if (otherProviders.length > 0) {
    lines.push('');
    lines.push(ansi.dim('  Other providers:'));
    for (const pid of otherProviders) {
      // Phase 2.2: prefer getModelCatalog() over deprecated getProviderModels()
      const ms = configMgr.getModelCatalog?.(pid) || BUILTIN_PROVIDERS[pid]?.models || [];
      const sample = ms.slice(0, 4).join(', ');
      const more = ms.length > 4 ? ansi.dim(`, +${ms.length - 4} more`) : '';
      lines.push(`  ${ansi.dim('•')} ${ansi.cyan(pid)}: ${ansi.white(sample)}${more}`);
    }
  }

  const box = renderBox(lines.join('\n'), {
    title: `Model (${targetProvider})`,
    borderStyle: 'round',
    borderColor: 'cyan',
    minWidth: 36,
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
      output: `${ansi.red('✖')} Missing model name. Usage: faycli model --set <model> [--provider <id>]\n`,
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
  // Phase 2.2: prefer getModelCatalog() over deprecated getProviderModels()
  const knownModels = configMgr.getModelCatalog?.(target) || [];
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
    inCatalog,
  };
}

/**
 * Add one or more models to a provider's catalog (does NOT change active model).
 *
 * Usage:
 *   addModelsCli({ configMgr, models: 'gpt-4,gpt-4o', providerOverride: 'openai' })
 *
 * Accepts:
 *   - comma/semicolon/newline separated string
 *   - array of strings
 *   - single string
 *
 * @param {object} options
 * @param {object} options.configMgr
 * @param {string|string[]} options.models
 * @param {string|null} [options.providerOverride=null]
 * @returns {{ exitCode: number, output: string|null, added: string[], skipped: string[], provider: string }}
 */
export function addModelsCli({ configMgr, models, providerOverride = null } = {}) {
  if (!configMgr) {
    return { exitCode: 1, output: null, error: 'ConfigManager unavailable' };
  }
  if (
    models === null ||
    models === undefined ||
    (typeof models === 'string' && !models.trim()) ||
    (Array.isArray(models) && models.length === 0)
  ) {
    return {
      exitCode: 1,
      output: `${ansi.red('✖')} Missing model name(s). Usage: faycli model --add <name[,name2,...]> [--provider <id>]\n`,
    };
  }

  const target = providerOverride || configMgr.get('activeProvider') || 'gemini';

  // Normalize to array for the manager call
  const input = Array.isArray(models) ? models : models;
  const result = configMgr.addProviderModels(target, input);
  const { added, skipped, catalog } = result;

  if (added.length === 0 && skipped.length > 0) {
    return {
      exitCode: 0,
      output: `\n${ansi.yellow('ℹ')} No new models added to ${ansi.bold(target)} — all ${skipped.length} already in catalog.\n`,
      added,
      skipped,
      provider: target,
      catalog,
    };
  }

  const lines = [];
  lines.push(
    `${ansi.green('✔')} Added ${ansi.bold(String(added.length))} model(s) to ${ansi.bold(ansi.cyan(target))}:`,
  );
  for (const m of added) {
    lines.push(`  ${ansi.green('+')} ${ansi.cyan(m)}`);
  }
  if (skipped.length > 0) {
    lines.push(
      ansi.dim(`  (${skipped.length} already in catalog, skipped: ${skipped.join(', ')})`),
    );
  }
  lines.push(ansi.dim(`  Catalog now has ${catalog.length} model(s).`));

  return {
    exitCode: 0,
    output: `\n${lines.join('\n')}\n`,
    added,
    skipped,
    provider: target,
    catalog,
  };
}

/**
 * Remove one or more models from a provider's catalog.
 * Will NOT remove the active model (use `faycli model --set <other>` first).
 *
 * @param {object} options
 * @param {object} options.configMgr
 * @param {string|string[]} options.models
 * @param {string|null} [options.providerOverride=null]
 * @returns {{ exitCode: number, output: string|null, removed: string[], skipped: string[], provider: string }}
 */
export function removeModelCli({ configMgr, models, providerOverride = null } = {}) {
  if (!configMgr) {
    return { exitCode: 1, output: null, error: 'ConfigManager unavailable' };
  }
  if (
    models === null ||
    models === undefined ||
    (typeof models === 'string' && !models.trim()) ||
    (Array.isArray(models) && models.length === 0)
  ) {
    return {
      exitCode: 1,
      output: `${ansi.red('✖')} Missing model name(s). Usage: faycli model --remove <name[,name2,...]> [--provider <id>]\n`,
    };
  }

  const target = providerOverride || configMgr.get('activeProvider') || 'gemini';
  const result = configMgr.removeProviderModels(target, models);
  const { removed, skipped, catalog } = result;

  if (removed.length === 0 && skipped.length > 0) {
    return {
      exitCode: 1,
      output: `\n${ansi.red('✖')} Could not remove ${skipped.length} model(s) from ${ansi.bold(target)} — they include the active model. Switch first with ${ansi.cyan(`faycli model --set <other>`)}.\n`,
      removed,
      skipped,
      provider: target,
      catalog,
    };
  }

  const lines = [];
  if (removed.length > 0) {
    lines.push(
      `${ansi.green('✔')} Removed ${ansi.bold(String(removed.length))} model(s) from ${ansi.bold(ansi.cyan(target))}:`,
    );
    for (const m of removed) {
      lines.push(`  ${ansi.red('-')} ${ansi.cyan(m)}`);
    }
  } else {
    lines.push(
      `${ansi.yellow('ℹ')} No models removed from ${ansi.bold(target)} — none of the specified names were in the catalog.`,
    );
  }
  if (skipped.length > 0) {
    lines.push(ansi.dim(`  Skipped (active model): ${skipped.join(', ')}`));
  }
  lines.push(ansi.dim(`  Catalog now has ${catalog.length} model(s).`));

  return {
    exitCode: 0,
    output: `\n${lines.join('\n')}\n`,
    removed,
    skipped,
    provider: target,
    catalog,
  };
}

/**
 * Reset a provider's catalog to its builtin defaults.
 * Preserves any custom finetune that is the active model.
 *
 * @param {object} options
 * @param {object} options.configMgr
 * @param {string|null} [options.providerOverride=null]
 * @returns {{ exitCode: number, output: string|null, provider: string, catalog: string[] }}
 */
export function clearModelsCli({ configMgr, providerOverride = null } = {}) {
  if (!configMgr) {
    return { exitCode: 1, output: null, error: 'ConfigManager unavailable' };
  }

  const target = providerOverride || configMgr.get('activeProvider') || 'gemini';
  const builtin = BUILTIN_PROVIDERS[target];
  const result = configMgr.clearProviderModels(target);
  const { catalog } = result;

  const isBuiltin = Boolean(builtin);
  const source = isBuiltin ? 'builtin defaults' : 'empty (custom provider)';

  return {
    exitCode: 0,
    output: `\n${ansi.green('✔')} Reset ${ansi.bold(ansi.cyan(target))} catalog to ${ansi.dim(source)}.\n${ansi.dim(`  Catalog now has ${catalog.length} model(s).`)}\n`,
    provider: target,
    catalog,
  };
}

/**
 * Dispatcher for `faycli model ...`. Called by bin/faycli.js.
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
      providerOverride: parsed?.flags?.provider || null,
    });
  }

  if (sub === 'set' || parsed?.flags?.modelSet) {
    return setModelCli({
      configMgr,
      model: parsed?.flags?.modelSet,
      providerOverride: parsed?.flags?.provider || null,
    });
  }

  if (sub === 'add' || parsed?.flags?.modelAdd) {
    return addModelsCli({
      configMgr,
      models: parsed?.flags?.modelAdd,
      providerOverride: parsed?.flags?.provider || null,
    });
  }

  if (sub === 'remove' || parsed?.flags?.modelRemove) {
    return removeModelCli({
      configMgr,
      models: parsed?.flags?.modelRemove,
      providerOverride: parsed?.flags?.provider || null,
    });
  }

  if (sub === 'clear' || parsed?.flags?.modelClear) {
    return clearModelsCli({
      configMgr,
      providerOverride: parsed?.flags?.provider || null,
    });
  }

  // Fallback: no recognized subcommand → list
  return listModelsCli({
    configMgr,
    all: Boolean(parsed?.flags?.modelAll),
    providerOverride: parsed?.flags?.provider || null,
  });
}
