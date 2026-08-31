# Security Policy

## Reporting a Vulnerability

termuxai grants an LLM shell access. If you find a security vulnerability, report it
privately — do not open a public issue. Open a private security advisory on GitHub or
contact the maintainers directly.

Please include:
- Steps to reproduce
- Affected version
- Impact description

## Security Model

Protection lives in `src/security/rules.js`, `src/security/guard.js`, and
`src/security/path-validator.js`:

- Regex blacklist of dangerous commands — bypassable, treated as last line, not a boundary
- `HARD_LIMITS`: 2000-char command cap, null-byte guard
- `OBFUSCATION_PATTERNS`: hex escapes, base64-to-shell, eval
- `PROTECTED_PATH_PATTERNS`: blocks `/`, `~`, `/etc`, `/boot`, `/var/lib`
- Path validation restricts writes to the safe workspace; `security.allowTermuxStorage`
  is opt-in (`termuxai config set security.allowTermuxStorage true`)

OS-level sandboxing (privilege drop, chroot/jail) is **not** implemented. Treat the agent
as capable of arbitrary code execution on your account.