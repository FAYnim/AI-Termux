/**
 * Application Constants & Default Configuration Values
 * Termux AI CLI (`termuxai`)
 */

export const APP_NAME = 'termuxai';
export const APP_FULL_NAME = 'termux-ai-cli';
export const APP_VERSION = '1.0.0';
export const APP_DESCRIPTION = 'Autonomous AI Agent CLI optimized for Termux Android environment';

// Configuration Paths
export const DEFAULT_CONFIG_DIR_NAME = '.termuxai';
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

// Built-in Providers & Defaults
export const BUILTIN_PROVIDERS = {
  gemini: {
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-2.5-flash',
    models: [
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-1.5-flash',
      'gemini-1.5-pro',
      'gemini-2.0-flash'
    ],
    envVars: ['GEMINI_API_KEY', 'TERMUXAI_API_KEY', 'T_AI_API_KEY'],
    envBaseUrlVars: [],
    envModelVars: [],
  },
  openai: {
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: [
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4',
      'gpt-3.5-turbo'
    ],
    envVars: ['OPENAI_API_KEY'],
    envBaseUrlVars: ['OPENAI_BASE_URL'],
    envModelVars: ['OPENAI_MODEL'],
  },
};

export const DEFAULT_ACTIVE_PROVIDER = 'gemini';

// Default Config Object
export const DEFAULT_CONFIG = {
  activeProvider: DEFAULT_ACTIVE_PROVIDER,
  providers: {},
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxContextTokens: DEFAULT_MAX_CONTEXT_TOKENS,
  autoConfirm: false,
  verbose: false,
};

