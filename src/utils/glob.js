/**
 * Glob pattern → RegExp for tool file matching (`*`, `**`, `?`).
 * No brace expansion, no character classes — models emit simple patterns.
 */

/** Escapes regex metacharacters in a literal string. */
export function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compiles a glob into an anchored RegExp.
 * Matching is done against forward-slash relative paths.
 *
 * @param {string} pattern - glob pattern supporting `*`, `**` and `?`
 * @returns {RegExp}
 */
export function globToRegExp(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*';
        i++;
        // consume a trailing "/" so "**/*.js" also matches root-level "a.js"
        if (pattern[i + 1] === '/') i++;
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else {
      out += escapeRegExp(c);
    }
  }
  return new RegExp(`^${out}$`);
}
