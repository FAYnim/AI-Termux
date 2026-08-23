# Termux AI CLI (`termuxai`)

> **Autonomous AI Agent CLI — Optimized for Termux Android & Linux**

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0-green)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-blue)](./LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Termux%20%7C%20Linux%20%7C%20macOS-informational)](https://termux.dev/)
[![PRD](https://img.shields.io/badge/Spec-PRD%20v1.0-orange)](./AI%20Termux.md)

---

## 📋 Overview

**Termux AI CLI (`termuxai`)** is a lightweight, zero-native-dependency autonomous AI agent designed specifically for **Android Termux** environments. It uses Google's Gemini API as its reasoning engine while performing file I/O, directory exploration, and shell command execution directly on your local Termux filesystem.

### Key Highlights

- 🤖 **ReAct Agentic Loop** — multi-turn reasoning and acting with autonomous self-correction
- 🔒 **Security Guard** — human-in-the-loop confirmation, command blacklist, safe path jail
- ⚡ **Ultra-Lightweight** — startup `< 300 ms`, RAM `< 50 MB` idle
- 📱 **Termux-Native** — no `node-gyp`, no binary compilation, pure ESM Node.js
- 🔧 **5 Local Tools** — `read_file`, `write_file`, `patch_file`, `list_dir`, `execute_command`
- 🎨 **Rich Terminal UI** — ANSI Markdown renderer, live spinner, syntax highlighting

---

## 📦 Installation

### Android Termux (Recommended)

```bash
# Option 1: One-command installer
curl -fsSL https://raw.githubusercontent.com/FAYnim/ai-termux/main/install.sh | bash

# Option 2: Manual install from source
pkg update && pkg install nodejs git
git clone https://github.com/FAYnim/ai-termux
cd ai-termux
npm link
```

### Linux / macOS

```bash
git clone https://github.com/FAYnim/ai-termux
cd ai-termux
npm link
```

### Windows (for development)

```bash
git clone https://github.com/FAYnim/ai-termux
cd ai-termux
npm link
```

> **Requirements:** Node.js >= 18.0.0

---

## 🔑 Setup: Gemini API Key

Get a free Gemini API key at **[aistudio.google.com](https://aistudio.google.com/)**

**Option A: Store in config (recommended)**
```bash
termuxai config set apiKey YOUR_GEMINI_API_KEY
```

**Option B: Environment variable**
```bash
# Add to ~/.bashrc or ~/.zshrc
export GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
# Or use:
export TERMUXAI_API_KEY="YOUR_GEMINI_API_KEY"
```

---

## 🌐 Multi-Provider Support

`termuxai` supports multiple LLM providers. Each provider owns its own API key, model, and base URL.

```bash
termuxai provider list                         # Show configured providers
termuxai provider use openai                   # Switch active provider (persists)
termuxai provider add openai --api-key "$KEY"  # Configure OpenAI
termuxai provider show gemini                  # Dump provider configuration as JSON
```

### One-Shot Provider Override

Run a command with a different provider without altering your default configuration:

```bash
termuxai --provider openai --model gpt-4o "translate this sentence"
```

Built-in providers: `gemini` (default), `openai`. OpenAI-compatible custom endpoints (OpenRouter, Groq, Ollama, LM Studio, etc.) are also supported.

### Environment Variables

| Provider | API Key | Base URL | Model |
|---|---|---|---|
| Gemini | `GEMINI_API_KEY`, `TERMUXAI_API_KEY`, `T_AI_API_KEY` | — | — |
| OpenAI | `OPENAI_API_KEY` | `OPENAI_BASE_URL` | `OPENAI_MODEL` |

Existing configurations and environment variables continue to work seamlessly. On first launch with no API keys configured, an interactive setup wizard appears automatically.

---

## 🚀 Quick Start

```bash
# Start interactive REPL
termuxai

# Single-shot task
termuxai "Buat fungsi kalkulator dalam JavaScript dengan operasi dasar"

# Single-shot task using OpenAI
termuxai --provider openai --model gpt-4o-mini "Buat REST API sederhana"

# UNIX pipe analysis
cat error.log | termuxai "Analisis IP mencurigakan dan ringkas error utama"

# Git commit message
git diff | termuxai "Buat pesan commit yang ringkas dan deskriptif"

# Use a specific model
termuxai --model gemini-2.5-pro "Refaktor kode ini untuk performa optimal"

# Auto-approve all actions (skip confirmation prompts)
termuxai -y "Instal dependensi dan jalankan tes"
```

---

## 📖 Usage Modes

### 1. Interactive REPL Mode

Start with `termuxai` (no arguments) to enter the interactive multi-turn REPL:

```
$ termuxai

  ┌─────────────────────────────────────────────────┐
  │  termuxai — Termux AI CLI  (gemini-2.5-flash)   │
  │  Working Directory: /data/data/com.termux/...    │
  └─────────────────────────────────────────────────┘

  You › Buat REST API sederhana dengan Express.js
```

#### Slash Commands (inside REPL)

| Command | Description |
|---|---|
| `/help` | Display all available slash commands |
| `/model [name]` | View or switch active model |
| `/session` | Show current session info and ID |
| `/clear` | Clear conversation history |
| `/config` | View current configuration |
| `/exit` or `/quit` | Exit the REPL |

### 2. Single-Shot Mode

```bash
termuxai "YOUR_TASK_HERE"
# Exits with code 0 on success, 1 on failure
```

### 3. UNIX Pipe Mode

```bash
# Analyze log files
cat access.log | termuxai "Ekstrak top-10 IP dengan request terbanyak"

# Review code changes
git diff HEAD~1 | termuxai "Review perubahan ini dan buat ringkasan"

# Analyze error output
npm test 2>&1 | termuxai "Jelaskan error test dan saran perbaikan"

# Process any text data
cat data.json | termuxai "Buat ringkasan dalam format Markdown"
```

### 4. Session Management

```bash
# List all saved sessions
termuxai session list

# Resume a previous session
termuxai resume sess_1700000000_abc123

# Delete a specific session
termuxai session delete sess_1700000000_abc123

# Clear all sessions
termuxai session clear

# Start with a specific session ID
termuxai --session sess_1700000000_abc123
```

---

## ⚙️ Configuration

### All Config Commands

```bash
# View all configuration
termuxai config list

# Get specific value
termuxai config get model
termuxai config get apiKey

# Set values
termuxai config set apiKey YOUR_KEY
termuxai config set model gemini-2.5-pro
termuxai config set timeoutMs 60000
termuxai config set autoConfirm true
termuxai config set verbose true

# Reset a key to default
termuxai config delete model

# Reset everything to defaults
termuxai config reset
```

### Available Configuration Keys

| Key | Default | Description |
|---|---|---|
| `apiKey` | `""` | Gemini API key (env fallback: `GEMINI_API_KEY`, `TERMUXAI_API_KEY`, or legacy `T_AI_API_KEY`) |
| `model` | `gemini-2.5-flash` | Default LLM model |
| `timeoutMs` | `30000` | Shell command timeout (ms) |
| `maxContextTokens` | `1000000` | Max tokens before context pruning |
| `autoConfirm` | `false` | Auto-approve all security prompts |
| `verbose` | `false` | Enable verbose debug logging |

### Supported Models

| Model | Description |
|---|---|
| `gemini-2.5-flash` | Default — fast, efficient, high capability |
| `gemini-2.5-pro` | Most powerful, best for complex reasoning |
| `gemini-1.5-flash` | Lightweight, very fast |
| `gemini-1.5-pro` | High-capability v1.5 |
| `gemini-2.0-flash` | Latest v2.0 flash variant |

---

## 🛡️ Security System

termuxai includes a multi-layer security guard for safe file and command execution:

### Protection Layers

1. **Safe Path Jail**: All file operations are constrained to the current working directory (CWD). Access outside CWD requires user confirmation.

2. **Command Blacklist**: Absolutely forbidden commands are rejected without prompting:
   - `rm -rf /`, `mkfs`, `dd if=/dev/zero`, `:(){ :|:& };:` (fork bomb), etc.

3. **Risky Command Confirmation**: Potentially destructive commands (e.g., `rm -rf`, `chmod 777`, `sudo`) trigger a `[y/N]` prompt before execution.

4. **Execution Timeout**: All shell commands have a configurable timeout (default: 30s) with `AbortController` enforcement.

5. **Human-in-the-Loop**: Every file write and command execution can be reviewed and approved/denied interactively.

### Confirmation Prompts

```
⚠ [SECURITY CHECK] AI wants to execute risky shell command:
  rm -rf ./dist
Proceed? [y/N]: y
```

### Auto-Approve Mode (`-y`)

```bash
# Skip all confirmation prompts (use in trusted environments only)
termuxai -y "Bersihkan direktori dist dan build ulang"
termuxai --yes "Deploy ke server staging"
```

### Termux Android Storage Access

On Termux, termuxai automatically permits access to Android shared storage paths (`/sdcard/`, `~/storage/shared`) when `termux-setup-storage` has been configured:

```bash
# Enable Android storage access in Termux (one-time setup)
termux-setup-storage
```

---

## 🔧 Local Tools (Actuators)

The AI can use 5 built-in tools to act on your local filesystem:

### `read_file`
```
Read file content with optional line-range slicing
Args: filePath, startLine?, endLine?, encoding?
```

### `write_file`
```
Write text content to a file (atomic write, auto-creates dirs)
Args: filePath, content, encoding?
```

### `patch_file`
```
Token-efficient search-and-replace on existing files
Args: filePath, searchString, replaceString
```

### `list_dir`
```
Explore directory structure with depth control
Args: dirPath?, depth?, showHidden?
```

### `execute_command`
```
Run shell commands with stdout/stderr capture and timeout
Args: command, workingDir?, timeoutMs?, env?
```

---

## 🤖 ReAct Agentic Loop

termuxai implements the **ReAct (Reasoning + Acting)** pattern:

```
User Prompt
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│                    ReAct Agentic Loop                        │
│                                                             │
│  ┌──────────┐   Tool Call   ┌───────────────────────────┐   │
│  │  Gemini  │──────────────▶│  Security Guard           │   │
│  │   API    │               │  • Blacklist check        │   │
│  │  (LLM)   │               │  • Path validation        │   │
│  └──────────┘               │  • Risky cmd confirmation │   │
│       ▲                     └───────────┬───────────────┘   │
│       │                                 │ Authorized         │
│       │                                 ▼                   │
│  Function    ┌──────────────────────────────────────────┐   │
│  Response    │  Local Actuator (node:fs, child_process) │   │
│       └──────│  read_file │ write_file │ execute_command│   │
│              └──────────────────────────────────────────┘   │
│                                                             │
│  Loop ends when: text response (no tool calls) OR max steps  │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
Final Answer (streamed to terminal)
```

### Self-Healing Bug Fix Example

```bash
termuxai "Buat file kalkulator calculator.js, tulis unit test, jalankan test, dan perbaiki bug sampai semua lulus"
```

termuxai will autonomously:
1. 📝 Write `calculator.js` with the calculator functions
2. 📝 Write `test-calculator.js` with test cases
3. 🔧 Run `node test-calculator.js`
4. 🔍 Read error output (if tests fail)
5. 🩹 Apply `patch_file` to fix the bug
6. 🔄 Re-run tests until exit code 0
7. ✅ Report success

---

## 📊 Performance

termuxai is engineered for the resource-constrained environment of Android phones:

| Metric | Target | Status |
|---|---|---|
| Startup Time | `< 300 ms` | ✅ Verified |
| Memory RSS (idle) | `< 50 MB` | ✅ Verified |
| Memory RSS (ReAct loop) | `< 50 MB` | ✅ Verified |
| Native Dependencies | Zero | ✅ Pure ESM |

### Run Benchmark Yourself

```bash
node scripts/benchmark.js
# Output:
#   Startup Time (avg)    142.35 ms     < 300 ms    ✔ PASS
#   Memory RSS            34.21 MB      < 50 MB     ✔ PASS
```

---

## 🧪 Testing

```bash
# Run all unit tests (Step 1–5)
npm test
# or
node --test tests/*.test.js

# Run E2E integration tests (Step 6)
node scripts/test-e2e.js
# or
node --test tests/e2e/*.test.js

# Run ALL tests (unit + E2E)
node --test tests/*.test.js tests/e2e/*.test.js

# Run benchmark
npm run benchmark
```

---

## 📁 Project Structure

```
ai-termux/
├── bin/
│   └── tai.js                    # CLI executable entry point
├── src/
│   ├── cli/
│   │   ├── args.js               # Argument parser
│   │   ├── help.js               # --help output
│   │   ├── piping.js             # UNIX stdin pipe handler
│   │   ├── repl.js               # Interactive REPL
│   │   ├── single-shot.js        # Single-shot task runner
│   │   └── slash-commands.js     # /help, /model, /session, etc.
│   ├── config/
│   │   ├── constants.js          # App constants & defaults
│   │   └── manager.js            # Config load/save/get/set
│   ├── security/
│   │   ├── rules.js              # Blacklist & risky patterns
│   │   ├── path-validator.js     # Safe path boundary checker
│   │   └── guard.js              # SecurityGuard class
│   ├── tools/
│   │   ├── read_file.js          # Tool: read file content
│   │   ├── write_file.js         # Tool: write file atomically
│   │   ├── patch_file.js         # Tool: search-and-replace patch
│   │   ├── list_dir.js           # Tool: directory explorer
│   │   ├── execute_command.js    # Tool: shell command executor
│   │   └── registry.js           # Tool registry & Gemini schemas
│   ├── llm/
│   │   ├── gemini.js             # Gemini API client (pure fetch)
│   │   ├── stream-parser.js      # SSE stream parser
│   │   ├── retry.js              # Exponential backoff retry
│   │   └── types.js              # Message type factories
│   ├── agent/
│   │   ├── orchestrator.js       # ReAct loop orchestrator
│   │   ├── session.js            # Session manager & persistence
│   │   ├── pruner.js             # Context token pruning
│   │   └── system-prompt.js      # System instruction builder
│   ├── ui/
│   │   ├── markdown.js           # ANSI Markdown renderer
│   │   ├── spinner.js            # Live terminal spinner
│   │   └── box.js                # Terminal box & banner
│   └── utils/
│       ├── ansi.js               # ANSI color helpers
│       ├── logger.js             # Logger utility
│       └── termux.js             # Termux environment detection
├── tests/
│   ├── step1-*.test.js           # Unit tests: Foundation & Config
│   ├── step2-*.test.js           # Unit tests: Security & Tools
│   ├── step3-*.test.js           # Unit tests: LLM & Streaming
│   ├── step4-*.test.js           # Unit tests: ReAct & Session
│   ├── step5-*.test.js           # Unit tests: REPL & UI
│   └── e2e/
│       ├── e2e-self-healing.test.js  # E2E: Bug fix loop
│       ├── e2e-piping.test.js        # E2E: UNIX pipe workflow
│       └── e2e-session-resume.test.js # E2E: Session persistence
├── scripts/
│   ├── benchmark.js              # Performance benchmark
│   └── test-e2e.js               # E2E test runner
├── plans/                        # Development plan documents
├── install.sh                    # One-command installer
├── package.json
└── README.md
```

---

## 🔌 CLI Reference

```
Usage: termuxai [OPTIONS] [PROMPT]

MODES:
  termuxai                          Start interactive REPL
  termuxai "PROMPT"                 Single-shot task execution
  cat file | termuxai "INSTRUCTION" UNIX stdin pipe analysis
  termuxai resume SESSION_ID        Resume saved session

PROVIDER COMMANDS:
  termuxai provider list            List configured providers
  termuxai provider use <id>        Set active provider (persist)
  termuxai provider add <id>        Add or update provider settings
  termuxai provider remove <id>     Remove a custom provider
  termuxai provider show [id]       Show provider config as JSON

CONFIG COMMANDS:
  termuxai config list              List all configuration
  termuxai config get KEY           Get config value
  termuxai config set KEY VALUE     Set config value
  termuxai config delete KEY        Reset key to default
  termuxai config reset             Reset all to defaults
  termuxai session list             List saved sessions
  termuxai session delete SESS_ID   Delete a session
  termuxai session clear            Delete all sessions

OPTIONS:
  -p, --provider ID                 One-shot provider override (e.g. gemini, openai)
  -m, --model MODEL                 Use specified model
  -k, --api-key KEY                 Override API key for this run
  -s, --session SESSION_ID          Resume or attach session
  -y, --yes                         Auto-approve all security prompts
  --verbose                         Enable verbose debug output
  --config-dir PATH                 Custom config directory
  --help                            Show this help message
  --version                         Show version number

ENVIRONMENT VARIABLES:
  GEMINI_API_KEY                    Gemini API key
  OPENAI_API_KEY                    OpenAI API key
  OPENAI_BASE_URL                   Custom OpenAI endpoint base URL
  OPENAI_MODEL                      Default OpenAI model
  TERMUXAI_API_KEY                  Fallback Gemini API key (legacy: T_AI_API_KEY)
  TERMUXAI_CONFIG_DIR               Override config directory path (legacy: T_AI_CONFIG_DIR)
```

---

## 🔍 Troubleshooting

### "Gemini API key is not configured"

```bash
# Set via CLI
termuxai config set apiKey YOUR_KEY

# Or export (add to ~/.bashrc)
export GEMINI_API_KEY="YOUR_KEY"
```

### "Permission denied" on bin/tai.js

```bash
chmod +x bin/tai.js
```

### "termuxai command not found" after install

```bash
# Reload PATH
hash -r
# Or restart terminal

# Verify npm global bin is in PATH
echo $PATH | tr ':' '\n' | grep -i npm

# On Termux, check:
ls $PREFIX/bin/termuxai
```

### Slow startup on Android

Termux Node.js startup can be slow on older devices. This is a system limitation. To improve:
```bash
# Use node with optimizations
node --jitless bin/tai.js  # Reduces JIT warmup time on ARM
```

### Rate limit errors (HTTP 429)

The retry module automatically handles 429 responses with exponential backoff (up to 3 retries). If rate limiting persists:
```bash
termuxai config set model gemini-1.5-flash  # Use a less-limited model
```

### Context too long / token limit exceeded

```bash
# Clear session and start fresh
termuxai session clear

# Or use in REPL:
/clear
```

---

## 📄 License

MIT License — see [LICENSE](./LICENSE) for details.

---

## 🙏 Credits

Built with ❤️ for the Android Termux developer community.

- **Runtime**: [Node.js](https://nodejs.org/) (ESM, zero native deps)
- **AI**: [Google Gemini API](https://aistudio.google.com/)
- **Platform**: [Termux](https://termux.dev/)
- **Author**: FAYnim
