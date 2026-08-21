/**
 * Application Constants & Default Configuration Values
 * Termux AI CLI (`t-ai`)
 */

export const APP_NAME = 't-ai';
export const APP_FULL_NAME = 'termux-ai-cli';
export const APP_VERSION = '1.0.0';
export const APP_DESCRIPTION = 'Autonomous AI Agent CLI optimized for Termux Android environment';

// Configuration Paths
export const DEFAULT_CONFIG_DIR_NAME = '.t-ai';
export const DEFAULT_CONFIG_FILE_NAME = 'config.json';
export const DEFAULT_SESSIONS_DIR_NAME = 'sessions';

// Fallback Termux home directory if os.homedir() returns empty or unusual root
export const TERMUX_HOME_FALLBACK = '/data/data/com.termux/files/home';

// Default Model & Parameters
export const DEFAULT_MODEL = 'gemini-2.5-flash';
export const SUPPORTED_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-2.0-flash'
];

// Execution Defaults
export const DEFAULT_TIMEOUT_MS = 30000; // 30 seconds
export const DEFAULT_MAX_CONTEXT_TOKENS = 1000000;
export const DEFAULT_TEMPERATURE = 0.7;

// Default Config Object
export const DEFAULT_CONFIG = {
  model: DEFAULT_MODEL,
  apiKey: '',
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxContextTokens: DEFAULT_MAX_CONTEXT_TOKENS,
  autoConfirm: false,
  verbose: false
};
