/**
 * Configuration Manager for Termux AI CLI
 * Manages configuration loading, atomic persistence, and API key resolution
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  BUILTIN_PROVIDERS,
  DEFAULT_ACTIVE_PROVIDER,
  DEFAULT_CONFIG,
  DEFAULT_CONFIG_DIR_NAME,
  DEFAULT_CONFIG_FILE_NAME,
  DEFAULT_MODEL,
  DEFAULT_SESSIONS_DIR_NAME,
  TERMUX_HOME_FALLBACK
} from './constants.js';

export class ConfigManager {
  constructor(customConfigDir = null) {
    this.customConfigDir = customConfigDir;
  }

  /**
   * Resolve root configuration directory
   * Priority: customConfigDir > process.env.TERMUXAI_CONFIG_DIR > process.env.T_AI_CONFIG_DIR > os.homedir()/.termuxai > fallback
   * @returns {string}
   */
  getConfigDir() {
    if (this.customConfigDir) {
      return path.resolve(this.customConfigDir);
    }
    if (process.env.TERMUXAI_CONFIG_DIR) {
      return path.resolve(process.env.TERMUXAI_CONFIG_DIR);
    }
    // Legacy env-var fallback for users upgrading from t-ai
    if (process.env.T_AI_CONFIG_DIR) {
      return path.resolve(process.env.T_AI_CONFIG_DIR);
    }

    const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir() || TERMUX_HOME_FALLBACK;
    const primaryDir = path.join(homeDir, DEFAULT_CONFIG_DIR_NAME);
    // Legacy directory fallback: if ~/.termuxai doesn't exist but ~/.t-ai does,
    // use the legacy dir so existing users' configs and sessions still load.
    const legacyDir = path.join(homeDir, '.t-ai');
    if (!fs.existsSync(primaryDir) && fs.existsSync(legacyDir)) {
      return legacyDir;
    }
    return primaryDir;
  }

  /**
   * Get path to config.json
   * @returns {string}
   */
  getConfigPath() {
    return path.join(this.getConfigDir(), DEFAULT_CONFIG_FILE_NAME);
  }

  /**
   * Get path to sessions directory
   * @returns {string}
   */
  getSessionsDir() {
    return path.join(this.getConfigDir(), DEFAULT_SESSIONS_DIR_NAME);
  }

  /**
   * Ensure directory structure exists
   */
  ensureDirs() {
    const configDir = this.getConfigDir();
    const sessionsDir = this.getSessionsDir();

    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    }
    if (!fs.existsSync(sessionsDir)) {
      fs.mkdirSync(sessionsDir, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Load configuration from file, initializing with defaults if missing
   * @returns {object}
   */
  loadConfig() {
    this.ensureDirs();
    const configPath = this.getConfigPath();

    if (!fs.existsSync(configPath)) {
      const fresh = structuredClone(DEFAULT_CONFIG);
      this.saveConfig(fresh);
      return fresh;
    }

    let parsed;
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      parsed = JSON.parse(raw);
    } catch (err) {
      // In case of corrupt file, fallback to defaults
      return structuredClone(DEFAULT_CONFIG);
    }
    const config = {
      ...structuredClone(DEFAULT_CONFIG),
      ...parsed,
      providers: { ...(parsed.providers || {}) }
    };

    // Auto-promote legacy apiKey into providers[activeProvider] if providers missing
    if (!config.providers || Object.keys(config.providers).length === 0) {
      const act = config.activeProvider || DEFAULT_ACTIVE_PROVIDER;
      if (!config.providers) config.providers = {};
      if (!config.providers[act]) {
        const provCfg = {};
        // Carry over legacy apiKey if present
        if (config.apiKey && typeof config.apiKey === 'string' && config.apiKey.trim()) {
          provCfg.apiKey = config.apiKey.trim();
        }
        if (config.model && typeof config.model === 'string' && config.model.trim()) {
          provCfg.model = config.model.trim();
        }
        // Check env match
        const builtin = BUILTIN_PROVIDERS[act];
        if (builtin && !provCfg.apiKey) {
          for (const envVar of builtin.envVars) {
            if (process.env[envVar]?.trim()) {
              provCfg.apiKey = process.env[envVar].trim();
              break;
            }
          }
        }
        if (Object.keys(provCfg).length > 0) {
          config.providers[act] = provCfg;
          config.activeProvider = act;
          this.saveConfig(config);
        }
      }
    }

    return config;
  }

  /**
   * Save configuration atomically to disk
   * @param {object} configData
   * @returns {object}
   */
  saveConfig(configData) {
    this.ensureDirs();
    const configPath = this.getConfigPath();
    const tmpPath = `${configPath}.tmp.${process.pid}.${Date.now()}`;
    const payload = JSON.stringify(configData, null, 2);

    fs.writeFileSync(tmpPath, payload, { encoding: 'utf8', mode: 0o600 });
    try {
      fs.renameSync(tmpPath, configPath);
    } catch (err) {
      // Fallback for filesystems that don't support atomic rename across mounts
      fs.copyFileSync(tmpPath, configPath);
      try {
        fs.unlinkSync(tmpPath);
      } catch (_) {}
    }

    return configData;
  }

  /**
   * Get specific configuration value
   * @param {string} key
   * @returns {any}
   */
  get(key) {
    const config = this.loadConfig();
    if (key.includes('.')) {
      const parts = key.split('.');
      let curr = config;
      for (const p of parts) {
        if (curr == null) return undefined;
        curr = curr[p];
      }
      return curr;
    }
    return config[key];
  }

  /**
   * Set configuration value
   * @param {string} key
   * @param {any} value
   * @returns {any}
   */
  set(key, value) {
    const config = this.loadConfig();

    let castedValue = value;
    if (key === 'timeoutMs' || key === 'maxContextTokens') {
      const parsedNum = Number(value);
      if (!Number.isNaN(parsedNum)) castedValue = parsedNum;
    } else if (key === 'autoConfirm' || key === 'verbose') {
      if (typeof value === 'string') {
        castedValue = value.toLowerCase() === 'true' || value === '1';
      } else {
        castedValue = Boolean(value);
      }
    }

    if (key.includes('.')) {
      const parts = key.split('.');
      let curr = config;
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i];
        if (!curr[p] || typeof curr[p] !== 'object') {
          curr[p] = {};
        }
        curr = curr[p];
      }
      curr[parts[parts.length - 1]] = castedValue;
    } else {
      config[key] = castedValue;
    }
    this.saveConfig(config);
    return castedValue;
  }

  /**
   * Delete or reset key to default
   * @param {string} key
   * @returns {boolean}
   */
  delete(key) {
    const config = this.loadConfig();
    const defaults = structuredClone(DEFAULT_CONFIG);
    if (Object.prototype.hasOwnProperty.call(defaults, key)) {
      config[key] = defaults[key];
    } else {
      delete config[key];
    }
    this.saveConfig(config);
    return true;
  }

  /**
   * Reset entire configuration to default
   * @returns {object}
   */
  reset() {
    const fresh = structuredClone(DEFAULT_CONFIG);
    this.saveConfig(fresh);
    return fresh;
  }

  /**
   * List all configuration keys (optionally masking API key)
   * @param {object} [options]
   * @param {boolean} [options.maskApiKey=true]
   * @returns {object}
   */
  list(options = { maskApiKey: true }) {
    const config = this.loadConfig();
    const result = { ...config };

    if (options.maskApiKey && result.apiKey) {
      result.apiKey = this.maskApiKey(result.apiKey);
    }
    if (options.maskApiKey && result.providers) {
      const maskedProviders = {};
      for (const [k, v] of Object.entries(result.providers)) {
        maskedProviders[k] = { ...v };
        if (maskedProviders[k].apiKey) {
          maskedProviders[k].apiKey = this.maskApiKey(maskedProviders[k].apiKey);
        }
      }
      result.providers = maskedProviders;
    }

    return result;
  }

  /**
   * Helper to mask API key for safe terminal display
   * @param {string} key
   * @returns {string}
   */
  maskApiKey(key) {
    if (!key || typeof key !== 'string') return '';
    if (key.length <= 8) return '****';
    return `${key.slice(0, 4)}...${key.slice(-4)}`;
  }

  /**
   * Get merged provider configuration
   * @param {string} providerId
   * @returns {object}
   */
  getProviderConfig(providerId) {
    const builtin = BUILTIN_PROVIDERS[providerId];
    const config = this.loadConfig();
    const stored = config.providers?.[providerId] || {};
    if (!builtin && !config.providers?.[providerId]) {
      throw new Error(`Unknown provider: ${providerId}`);
    }
    const merged = { ...(builtin || {}), ...stored };

    // Env vars override defaults if stored value is not present
    if (!stored.apiKey && builtin?.envVars) {
      for (const envVar of builtin.envVars) {
        const v = process.env[envVar];
        if (v?.trim()) {
          merged.apiKey = v.trim();
          break;
        }
      }
    }

    if (!stored.baseUrl && builtin?.envBaseUrlVars) {
      for (const envVar of builtin.envBaseUrlVars) {
        const v = process.env[envVar];
        if (v?.trim()) {
          merged.baseUrl = v.trim();
          break;
        }
      }
    }

    if (!stored.model && builtin?.envModelVars) {
      for (const envVar of builtin.envModelVars) {
        const v = process.env[envVar];
        if (v?.trim()) {
          merged.model = v.trim();
          break;
        }
      }
    }

    return merged;
  }

  /**
   * Resolve API Key following precedence:
   * 1. overrideKey (CLI flag)
   * 2. process.env per provider
   * 3. config.json providers[providerId].apiKey
   * @param {string} [overrideKey]
   * @param {string} [providerId]
   * @returns {string|null}
   */
  getApiKey(overrideKey = null, providerId = null) {
    if (overrideKey && typeof overrideKey === 'string' && overrideKey.trim().length > 0) {
      return overrideKey.trim();
    }
    const resolvedProvider = providerId || this.loadConfig().activeProvider || DEFAULT_ACTIVE_PROVIDER;
    const builtin = BUILTIN_PROVIDERS[resolvedProvider];
    // 1. Env vars lookup
    if (builtin?.envVars) {
      for (const envVar of builtin.envVars) {
        const v = process.env[envVar];
        if (v && typeof v === 'string' && v.trim().length > 0) {
          return v.trim();
        }
      }
    }
    // 2. Config lookup (providers[providerId].apiKey or legacy config.apiKey)
    const config = this.loadConfig();
    const storedKey = config.providers?.[resolvedProvider]?.apiKey || (resolvedProvider === 'gemini' ? config.apiKey : null);
    if (storedKey && typeof storedKey === 'string' && storedKey.trim().length > 0) {
      return storedKey.trim();
    }
    return null;
  }

  /**
   * Set a specific provider field and persist
   *
   * Fallback auto-include: when `field === 'model'`, we always make
   * sure the value is reflected in `providers[providerId].models[]`
   * so listings (`tai model --list`, `/model`, etc.) can never lose
   * the active selection — even for **custom (non-builtin) providers**
   * and even when the `models[]` array is missing entirely.
   *
   * @param {string} providerId
   * @param {string} field
   * @param {any} value
   */
  setProviderField(providerId, field, value) {
    const config = this.loadConfig();
    if (!config.providers) config.providers = {};
    if (!config.providers[providerId]) config.providers[providerId] = {};
    if (value === '' || value === null || value === undefined) {
      delete config.providers[providerId][field];
    } else {
      config.providers[providerId][field] = value;
    }
    // Auto-populate `models` from builtin when first configuring a builtin provider
    if (BUILTIN_PROVIDERS[providerId] && !config.providers[providerId].models) {
      const builtinModels = BUILTIN_PROVIDERS[providerId].models;
      if (Array.isArray(builtinModels) && builtinModels.length > 0) {
        config.providers[providerId].models = [...builtinModels];
      }
    }
    // Fallback: when the user picks a `model`, make sure it lives in
    // `models[]` too (create the array if missing). This covers:
    //   - custom providers that have no builtin catalog
    //   - legacy configs where `models[]` was wiped or never written
    //   - builtin providers whose `models[]` was cleared by the user
    if (field === 'model') {
      const prov = config.providers[providerId];
      if (!Array.isArray(prov.models)) prov.models = [];
      const v = typeof value === 'string' ? value.trim() : '';
      if (v && !prov.models.includes(v)) {
        prov.models.push(v);
      }
    }
    this.saveConfig(config);
  }

  /**
   * Get available models for a provider
   * Merges builtin defaults with any user-customized list, and ALSO
   * guarantees that the currently stored active `model` (if any) is
   * included so it never disappears from listings after the user sets
   * it via `tai model --set <name>`.
   *
   * ⭐ Ideal solution: auto-include stored model even if `models[]`
   *    is missing or empty (e.g. legacy configs, custom providers,
   *    or configs where the user wiped the `models` array).
   *
   * Precedence (all deduplicated, first occurrence wins):
   *   1. builtin.defaultModel
   *   2. stored `model`           ← the user's active/selected model
   *   3. stored `models[]`        ← user-customized catalog
   *   4. builtin `models[]`       ← builtin catalog
   *
   * @param {string} providerId
   * @returns {string[]}
   */
  getProviderModels(providerId) {
    const builtin = BUILTIN_PROVIDERS[providerId];
    const config = this.loadConfig();
    const stored = config.providers?.[providerId] || {};

    const builtinModels = builtin?.models || [];
    const storedModels = Array.isArray(stored.models) ? stored.models : [];
    // The currently-active model the user picked (may be a custom finetune
    // or a model not present in the catalog). We always surface it.
    const activeModel = typeof stored.model === 'string' && stored.model.trim()
      ? stored.model.trim()
      : null;

    // Combine: builtin default model first, then active model, then
    // stored catalog, then builtin catalog. Deduplicate while preserving
    // first-occurrence order so `(active)` markers stay consistent.
    const merged = [];
    const seen = new Set();
    const push = (m) => {
      if (typeof m !== 'string') return;
      const v = m.trim();
      if (!v || seen.has(v)) return;
      seen.add(v);
      merged.push(v);
    };

    push(builtin?.defaultModel);
    push(activeModel);
    for (const m of storedModels) push(m);
    for (const m of builtinModels) push(m);
    return merged;
  }

  /**
   * Remove custom provider (refuses built-in providers)
   * @param {string} providerId
   */
  removeProvider(providerId) {
    if (BUILTIN_PROVIDERS[providerId]) {
      throw new Error(`Cannot remove builtin provider "${providerId}"`);
    }
    const config = this.loadConfig();
    delete config.providers?.[providerId];
    this.saveConfig(config);
  }
}

// Singleton default export instance
export const configManager = new ConfigManager();
