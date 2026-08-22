/**
 * Configuration Manager for Termux AI CLI
 * Manages configuration loading, atomic persistence, and API key resolution
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  DEFAULT_CONFIG,
  DEFAULT_CONFIG_DIR_NAME,
  DEFAULT_CONFIG_FILE_NAME,
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
      this.saveConfig(DEFAULT_CONFIG);
      return { ...DEFAULT_CONFIG };
    }

    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_CONFIG, ...parsed };
    } catch (err) {
      // In case of corrupt file, fallback to defaults
      return { ...DEFAULT_CONFIG };
    }
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

    config[key] = castedValue;
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
    if (Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, key)) {
      config[key] = DEFAULT_CONFIG[key];
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
    this.saveConfig(DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
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
   * Resolve API Key following precedence:
   * 1. overrideKey (CLI flag)
   * 2. process.env.GEMINI_API_KEY
   * 3. process.env.TERMUXAI_API_KEY
   * 4. process.env.T_AI_API_KEY (legacy fallback)
   * 5. config.json apiKey
   * @param {string} [overrideKey]
   * @returns {string|null}
   */
  getApiKey(overrideKey = null) {
    if (overrideKey && typeof overrideKey === 'string' && overrideKey.trim().length > 0) {
      return overrideKey.trim();
    }

    if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0) {
      return process.env.GEMINI_API_KEY.trim();
    }

    if (process.env.TERMUXAI_API_KEY && process.env.TERMUXAI_API_KEY.trim().length > 0) {
      return process.env.TERMUXAI_API_KEY.trim();
    }

    // Legacy fallback for users upgrading from t-ai
    if (process.env.T_AI_API_KEY && process.env.T_AI_API_KEY.trim().length > 0) {
      return process.env.T_AI_API_KEY.trim();
    }

    const config = this.loadConfig();
    if (config.apiKey && typeof config.apiKey === 'string' && config.apiKey.trim().length > 0) {
      return config.apiKey.trim();
    }

    return null;
  }
}

// Singleton default export instance
export const configManager = new ConfigManager();
