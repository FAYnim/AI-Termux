/**
 * Security Rules & Pattern Definitions for Termux AI CLI (`t-ai`)
 */

/**
 * Commands that are strictly forbidden under any circumstances.
 * Attempting to execute any matching command will result in an immediate security error.
 */
export const BLACKLIST_PATTERNS = [
  // rm -rf / or root/home directory wipes
  /\brm\s+-[a-zA-Z0-9]*r[a-zA-Z0-9]*f[a-zA-Z0-9]*\s+((\/|\/\*|~|~\/\*|\$HOME\/?|\$\{HOME\}\/?)\s*($|[;&|><]))/i,
  /\brm\s+--no-preserve-root/i,

  // Disk formatting and block device overwrites
  /\bmkfs(\.[a-z0-9]+)?\s+/i,
  /\bdd\s+.*of=\/(dev|system)\//i,
  />\s*\/dev\/(sd[a-z]|hd[a-z]|nvme[0-9]n[0-9]|block|kmem|mem)/i,

  // Classic fork bombs
  /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,

  // System-wide permission breaks
  /\bchmod\s+-[a-zA-Z0-9]*R[a-zA-Z0-9]*\s+(777|000)\s+((\/|\/\*|~|\$HOME)\s*($|[;&|><]))/i,
  /\bchown\s+-[a-zA-Z0-9]*R[a-zA-Z0-9]*\s+.*\s+((\/|\/\*|~|\$HOME)\s*($|[;&|><]))/i,

  // System partition remounts in Android/Linux
  /\bmount\s+.*-o\s+.*remount,rw\s+\/(system|vendor|product)?/i
];

/**
 * Commands that modify the system or filesystem and require human confirmation [y/N]
 * unless auto-approved via `--yes` / `-y`.
 */
export const RISKY_COMMAND_PATTERNS = [
  // Deletion operations
  /\b(rm|unlink|rmdir)\b/i,

  // Dangerous Git operations
  /\bgit\s+(reset\s+--hard|clean\s+-[a-zA-Z0-9]*f|push\s+-[a-zA-Z0-9]*f|push\s+.*--force|branch\s+-D)/i,

  // Permission modifications
  /\b(chmod|chown|chgrp)\b/i,

  // Process terminations
  /\b(kill|pkill|killall)\b/i,

  // Pipe remote scripts to shell
  /\b(curl|wget|fetch)\b.*\|\s*(bash|sh|zsh|dash|ksh|python|perl|ruby)/i,

  // System package operations
  /\b(apt|pkg|apt-get|pacman|apk)\s+(remove|purge|autoremove|clean)/i,

  // Global installations
  /\b(npm|yarn|pnpm)\s+install\s+-g\b/i
];

/**
 * Default directory names and files to ignore during scans and directory listings
 */
export const DEFAULT_IGNORE_PATTERNS = [
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '.cache',
  '.t-ai',
  '.next',
  '.nuxt',
  '__pycache__',
  '.venv',
  'venv',
  'coverage',
  '.DS_Store',
  'Thumbs.db'
];

/**
 * Known binary file extensions
 */
export const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svgz',
  '.mp3', '.mp4', '.wav', '.ogg', '.flac', '.avi', '.mov', '.mkv',
  '.zip', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.exe', '.bin', '.dll', '.so', '.dylib', '.elf', '.apk', '.dex',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.iso', '.img', '.dmg', '.sqlite', '.db'
]);

/**
 * Default security thresholds & execution limits
 */
export const DEFAULT_SECURITY_CONFIG = {
  // Max bytes for reading a file to prevent token exhaustion (500 KB)
  maxReadSizeBytes: 500 * 1024,

  // Max lines returned per read
  maxReadLines: 1000,

  // Default timeout for shell command execution (30 seconds)
  defaultCommandTimeoutMs: 30000,

  // Max bytes for command output capture (50 KB)
  maxOutputSizeBytes: 50 * 1024,

  // Max lines for command output capture
  maxOutputLines: 500
};
