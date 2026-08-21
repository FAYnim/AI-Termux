#!/bin/bash
# ============================================================================
# Termux AI CLI (`t-ai`) — One-Command Installer
# Supports: Android Termux, Linux (Debian/Ubuntu/Arch), macOS
#
# Usage:
#   bash install.sh
#   curl -fsSL https://raw.githubusercontent.com/FAYnim/ai-termux/main/install.sh | bash
# ============================================================================

set -e

# ── ANSI Colors ─────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

log_info()    { echo -e "${CYAN}ℹ${RESET}  $1"; }
log_success() { echo -e "${GREEN}✔${RESET}  $1"; }
log_warn()    { echo -e "${YELLOW}⚠${RESET}  $1"; }
log_error()   { echo -e "${RED}✘${RESET}  $1"; }
log_step()    { echo -e "\n${BOLD}${CYAN}──${RESET} $1"; }

# ── Detect Environment ───────────────────────────────────────────
detect_environment() {
  IS_TERMUX=false
  IS_MACOS=false
  IS_LINUX=false

  if [ -n "$TERMUX_VERSION" ] || [ -n "$PREFIX" ] && echo "$PREFIX" | grep -q "com.termux"; then
    IS_TERMUX=true
  elif [ "$(uname -s)" = "Darwin" ]; then
    IS_MACOS=true
  else
    IS_LINUX=true
  fi
}

# ── Print Banner ─────────────────────────────────────────────────
print_banner() {
  echo ""
  echo -e "${BOLD}${CYAN}  ████████╗       █████╗ ██╗${RESET}"
  echo -e "${BOLD}${CYAN}     ██╔══╝      ██╔══██╗██║${RESET}"
  echo -e "${BOLD}${CYAN}     ██║    ─────███████║██║${RESET}"
  echo -e "${BOLD}${CYAN}     ██║         ██╔══██║██║${RESET}"
  echo -e "${BOLD}${CYAN}     ██║         ██║  ██║██║${RESET}"
  echo -e "${BOLD}${CYAN}     ╚═╝         ╚═╝  ╚═╝╚═╝${RESET}"
  echo ""
  echo -e "${BOLD}  Termux AI CLI (t-ai) — Installer${RESET}"
  echo -e "${CYAN}  Autonomous AI Agent for Termux Android & Linux${RESET}"
  echo ""
}

# ── Check Node.js ────────────────────────────────────────────────
check_node() {
  log_step "Checking Node.js installation"

  if command -v node &>/dev/null; then
    NODE_VERSION=$(node --version 2>/dev/null)
    NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v\([0-9]*\).*/\1/')

    if [ "$NODE_MAJOR" -ge 18 ]; then
      log_success "Node.js $NODE_VERSION found (>= v18 requirement met)"
    else
      log_warn "Node.js $NODE_VERSION is below required v18. Attempting upgrade..."
      install_node
    fi
  else
    log_warn "Node.js not found. Installing..."
    install_node
  fi
}

# ── Install Node.js ──────────────────────────────────────────────
install_node() {
  if [ "$IS_TERMUX" = true ]; then
    log_info "Installing Node.js via Termux pkg..."
    pkg update -y && pkg install -y nodejs
  elif [ "$IS_MACOS" = true ]; then
    if command -v brew &>/dev/null; then
      log_info "Installing Node.js via Homebrew..."
      brew install node
    else
      log_error "Homebrew not found. Please install Node.js >= 18 from https://nodejs.org/"
      exit 1
    fi
  elif [ "$IS_LINUX" = true ]; then
    if command -v apt-get &>/dev/null; then
      log_info "Installing Node.js 20.x via NodeSource (Debian/Ubuntu)..."
      curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
      sudo apt-get install -y nodejs
    elif command -v pacman &>/dev/null; then
      log_info "Installing Node.js via pacman (Arch)..."
      sudo pacman -S --noconfirm nodejs npm
    elif command -v dnf &>/dev/null; then
      log_info "Installing Node.js via dnf (Fedora/RHEL)..."
      sudo dnf install -y nodejs
    else
      log_error "Cannot auto-install Node.js. Please install Node.js >= 18 from https://nodejs.org/"
      exit 1
    fi
  fi

  # Verify installation succeeded
  if ! command -v node &>/dev/null; then
    log_error "Node.js installation failed. Please install manually."
    exit 1
  fi
  log_success "Node.js $(node --version) installed successfully"
}

# ── Setup Directories ────────────────────────────────────────────
setup_directories() {
  log_step "Setting up t-ai directories"

  T_AI_DIR="$HOME/.t-ai"
  SESSIONS_DIR="$T_AI_DIR/sessions"

  mkdir -p "$T_AI_DIR"
  chmod 700 "$T_AI_DIR"

  mkdir -p "$SESSIONS_DIR"
  chmod 700 "$SESSIONS_DIR"

  log_success "Config directory: $T_AI_DIR"
  log_success "Sessions directory: $SESSIONS_DIR"

  # Termux storage setup reminder
  if [ "$IS_TERMUX" = true ]; then
    if [ ! -d "$HOME/storage" ]; then
      echo ""
      log_warn "Termux storage access not configured."
      log_info "To allow t-ai to access /sdcard, run: termux-setup-storage"
    fi
  fi
}

# ── Install t-ai ─────────────────────────────────────────────────
install_tai() {
  log_step "Installing t-ai CLI"

  # Determine install directory (where this script lives)
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

  # Verify this looks like the ai-termux project directory
  if [ ! -f "$SCRIPT_DIR/package.json" ]; then
    log_error "package.json not found in $SCRIPT_DIR"
    log_error "Please run this script from the ai-termux project root directory."
    exit 1
  fi

  if [ ! -f "$SCRIPT_DIR/bin/tai.js" ]; then
    log_error "bin/tai.js not found. The project may be incomplete."
    exit 1
  fi

  # Make binary executable
  chmod +x "$SCRIPT_DIR/bin/tai.js"
  log_success "Set executable permission on bin/tai.js"

  # Install globally using npm link or npm install -g
  log_info "Linking t-ai globally via npm..."
  cd "$SCRIPT_DIR"

  if npm link 2>/dev/null; then
    log_success "t-ai linked globally via npm link"
  else
    log_warn "npm link failed, trying npm install -g ..."
    if npm install -g . 2>/dev/null; then
      log_success "t-ai installed globally via npm install -g"
    else
      # Fallback: create manual symlink in ~/.local/bin or $PREFIX/bin (Termux)
      log_warn "npm global install failed. Creating manual symlink..."
      create_symlink "$SCRIPT_DIR/bin/tai.js"
    fi
  fi
}

# ── Create Manual Symlink (fallback) ────────────────────────────
create_symlink() {
  local TAI_BIN="$1"

  if [ "$IS_TERMUX" = true ] && [ -n "$PREFIX" ]; then
    LINK_DIR="$PREFIX/bin"
  elif [ -d "$HOME/.local/bin" ]; then
    LINK_DIR="$HOME/.local/bin"
    # Ensure ~/.local/bin is in PATH
    if ! echo "$PATH" | grep -q "$HOME/.local/bin"; then
      log_warn "Add '$HOME/.local/bin' to your PATH in ~/.bashrc or ~/.zshrc"
    fi
  else
    mkdir -p "$HOME/.local/bin"
    LINK_DIR="$HOME/.local/bin"
  fi

  # Create symlinks for both t-ai and tai
  ln -sf "$TAI_BIN" "$LINK_DIR/t-ai" 2>/dev/null || true
  ln -sf "$TAI_BIN" "$LINK_DIR/tai" 2>/dev/null || true
  log_success "Symlinks created in $LINK_DIR"
}

# ── Post-Install: Verify & Print Guide ──────────────────────────
post_install() {
  log_step "Verifying installation"

  sleep 0.5

  if command -v t-ai &>/dev/null; then
    TAI_VERSION=$(t-ai --version 2>/dev/null || echo "unknown")
    log_success "t-ai command is available: t-ai $TAI_VERSION"
  elif command -v tai &>/dev/null; then
    log_success "tai command is available"
  else
    log_warn "Could not find t-ai in PATH. You may need to restart your terminal."
    log_info "Try: hash -r  (to reload PATH)"
  fi

  echo ""
  echo -e "${BOLD}${GREEN}✔ Installation Complete!${RESET}"
  echo ""
  echo -e "${BOLD}  Next Steps:${RESET}"
  echo ""
  echo -e "  1. ${BOLD}Set your Gemini API key:${RESET}"
  echo -e "     ${CYAN}t-ai config set apiKey YOUR_GEMINI_API_KEY${RESET}"
  echo -e "     ${CYAN}# Or export as environment variable:${RESET}"
  echo -e "     ${CYAN}export GEMINI_API_KEY=\"YOUR_GEMINI_API_KEY\"${RESET}"
  echo ""
  echo -e "     Get a free API key at: ${CYAN}https://aistudio.google.com/${RESET}"
  echo ""
  echo -e "  2. ${BOLD}Start the interactive REPL:${RESET}"
  echo -e "     ${CYAN}t-ai${RESET}  or  ${CYAN}tai${RESET}"
  echo ""
  echo -e "  3. ${BOLD}Run a single task:${RESET}"
  echo -e "     ${CYAN}t-ai \"Buat fungsi add(a, b) di JavaScript\"${RESET}"
  echo ""
  echo -e "  4. ${BOLD}Use with UNIX pipes:${RESET}"
  echo -e "     ${CYAN}cat error.log | t-ai \"Analisis IP mencurigakan\"${RESET}"
  echo -e "     ${CYAN}git diff | t-ai \"Buat pesan commit\"${RESET}"
  echo ""
  echo -e "  5. ${BOLD}Get help:${RESET}"
  echo -e "     ${CYAN}t-ai --help${RESET}"
  echo ""
}

# ── Main ─────────────────────────────────────────────────────────
main() {
  print_banner
  detect_environment

  if [ "$IS_TERMUX" = true ]; then
    log_info "Detected environment: Android Termux"
  elif [ "$IS_MACOS" = true ]; then
    log_info "Detected environment: macOS"
  else
    log_info "Detected environment: Linux"
  fi

  check_node
  setup_directories
  install_tai
  post_install
}

main "$@"
