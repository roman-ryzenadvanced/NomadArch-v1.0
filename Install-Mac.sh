#!/bin/bash

# NomadArch Installer for macOS
# Version: 0.4.0

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="$SCRIPT_DIR"
BIN_DIR="$TARGET_DIR/bin"
LOG_FILE="$TARGET_DIR/install.log"
ERRORS=0
WARNINGS=0
NEEDS_FALLBACK=0

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

echo ""
echo "NomadArch Installer (macOS)"
echo "Version: 0.4.0"
echo ""

log "Installer started"

echo "[STEP 1/9] OS and Architecture Detection"
OS_TYPE=$(uname -s)
ARCH_TYPE=$(uname -m)
log "OS: $OS_TYPE"
log "Architecture: $ARCH_TYPE"

if [[ "$OS_TYPE" != "Darwin" ]]; then
    echo -e "${RED}[ERROR]${NC} This installer is for macOS. Current OS: $OS_TYPE"
    log "ERROR: Not macOS ($OS_TYPE)"
    exit 1
fi

case "$ARCH_TYPE" in
    arm64) ARCH="arm64" ;;
    x86_64) ARCH="x64" ;;
    *)
        echo -e "${RED}[ERROR]${NC} Unsupported architecture: $ARCH_TYPE"
        log "ERROR: Unsupported arch $ARCH_TYPE"
        exit 1
        ;;
esac

echo -e "${GREEN}[OK]${NC} OS: macOS"
echo -e "${GREEN}[OK]${NC} Architecture: $ARCH_TYPE"

echo ""
echo "[STEP 2/9] Checking write permissions"
mkdir -p "$BIN_DIR"
if ! touch "$SCRIPT_DIR/.install-write-test" 2>/dev/null; then
    echo -e "${YELLOW}[WARN]${NC} No write access to $SCRIPT_DIR"
    TARGET_DIR="$HOME/.nomadarch-install"
    BIN_DIR="$TARGET_DIR/bin"
    LOG_FILE="$TARGET_DIR/install.log"
    mkdir -p "$BIN_DIR"
    if ! touch "$TARGET_DIR/.install-write-test" 2>/dev/null; then
        echo -e "${RED}[ERROR]${NC} Cannot write to $TARGET_DIR"
        log "ERROR: Write permission denied to fallback"
        exit 1
    fi
    rm -f "$TARGET_DIR/.install-write-test"
    NEEDS_FALLBACK=1
    echo -e "${GREEN}[OK]${NC} Using fallback: $TARGET_DIR"
else
    rm -f "$SCRIPT_DIR/.install-write-test"
    echo -e "${GREEN}[OK]${NC} Write access OK"
fi

log "Install target: $TARGET_DIR"

echo ""
echo "[STEP 3/9] Ensuring system dependencies"

if ! command -v curl >/dev/null 2>&1; then
    echo -e "${RED}[ERROR]${NC} curl is required but not available"
    exit 1
fi

if ! command -v brew >/dev/null 2>&1; then
    echo -e "${YELLOW}[INFO]${NC} Homebrew not found. Installing..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

MISSING_PKGS=()
command -v git >/dev/null 2>&1 || MISSING_PKGS+=("git")
command -v node >/dev/null 2>&1 || MISSING_PKGS+=("node")

if [[ ${#MISSING_PKGS[@]} -gt 0 ]]; then
    echo -e "${BLUE}[INFO]${NC} Installing: ${MISSING_PKGS[*]}"
    brew install "${MISSING_PKGS[@]}"
fi

if ! command -v node >/dev/null 2>&1; then
    echo -e "${RED}[ERROR]${NC} Node.js install failed"
    exit 1
fi

NODE_VERSION=$(node --version)
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d'v' -f2 | cut -d'.' -f1)
echo -e "${GREEN}[OK]${NC} Node.js: $NODE_VERSION"
if [[ $NODE_MAJOR -lt 18 ]]; then
    echo -e "${YELLOW}[WARN]${NC} Node.js 18+ is recommended"
    ((WARNINGS++))
fi

if ! command -v npm >/dev/null 2>&1; then
    echo -e "${RED}[ERROR]${NC} npm is not available"
    exit 1
fi
NPM_VERSION=$(npm --version)
echo -e "${GREEN}[OK]${NC} npm: $NPM_VERSION"

if command -v git >/dev/null 2>&1; then
    echo -e "${GREEN}[OK]${NC} Git: $(git --version)"
else
    echo -e "${YELLOW}[WARN]${NC} Git not found (optional)"
    ((WARNINGS++))
fi

echo ""
echo "[STEP 4/9] Installing npm dependencies"
cd "$SCRIPT_DIR"
log "Running npm install"
if ! npm install; then
    echo -e "${RED}[ERROR]${NC} npm install failed"
    log "ERROR: npm install failed"
    exit 1
fi

echo -e "${GREEN}[OK]${NC} Dependencies installed"

echo ""
echo "[STEP 5/9] Fetching OpenCode binary"
mkdir -p "$BIN_DIR"
OPENCODE_VERSION=$(curl -s https://api.github.com/repos/sst/opencode/releases/latest | grep '"tag_name"' | cut -d'"' -f4)
OPENCODE_BASE="https://github.com/sst/opencode/releases/download/v${OPENCODE_VERSION}"
OPENCODE_URL="${OPENCODE_BASE}/opencode-darwin-${ARCH}"
CHECKSUM_URL="${OPENCODE_BASE}/checksums.txt"

if [[ -f "$BIN_DIR/opencode" ]]; then
    echo -e "${GREEN}[OK]${NC} OpenCode binary already exists"
else
    echo -e "${BLUE}[INFO]${NC} Downloading OpenCode v${OPENCODE_VERSION}"
    curl -L -o "$BIN_DIR/opencode.tmp" "$OPENCODE_URL"
    curl -L -o "$BIN_DIR/checksums.txt" "$CHECKSUM_URL"

    EXPECTED_HASH=$(grep "opencode-darwin-${ARCH}" "$BIN_DIR/checksums.txt" | awk '{print $1}')
    ACTUAL_HASH=$(shasum -a 256 "$BIN_DIR/opencode.tmp" | awk '{print $1}')

    if [[ "$ACTUAL_HASH" == "$EXPECTED_HASH" ]]; then
        mv "$BIN_DIR/opencode.tmp" "$BIN_DIR/opencode"
        chmod +x "$BIN_DIR/opencode"
        echo -e "${GREEN}[OK]${NC} OpenCode downloaded and verified"
    else
        echo -e "${RED}[ERROR]${NC} OpenCode checksum mismatch"
        rm -f "$BIN_DIR/opencode.tmp"
        exit 1
    fi
fi

echo ""
echo "[STEP 6/9] Building UI assets"
if [[ -d "$SCRIPT_DIR/packages/ui/dist" ]]; then
    echo -e "${GREEN}[OK]${NC} UI build already exists"
else
    echo -e "${BLUE}[INFO]${NC} Building UI"
    pushd "$SCRIPT_DIR/packages/ui" >/dev/null
    npm run build
    popd >/dev/null
    echo -e "${GREEN}[OK]${NC} UI assets built"
fi

echo ""
echo "[STEP 7/9] Post-install health check"
HEALTH_ERRORS=0

[[ -f "$SCRIPT_DIR/package.json" ]] || HEALTH_ERRORS=$((HEALTH_ERRORS+1))
[[ -d "$SCRIPT_DIR/packages/ui" ]] || HEALTH_ERRORS=$((HEALTH_ERRORS+1))
[[ -d "$SCRIPT_DIR/packages/server" ]] || HEALTH_ERRORS=$((HEALTH_ERRORS+1))
[[ -f "$SCRIPT_DIR/packages/ui/dist/index.html" ]] || HEALTH_ERRORS=$((HEALTH_ERRORS+1))

if [[ $HEALTH_ERRORS -eq 0 ]]; then
    echo -e "${GREEN}[OK]${NC} Health checks passed"
else
    echo -e "${RED}[ERROR]${NC} Health checks failed ($HEALTH_ERRORS)"
    ERRORS=$((ERRORS+HEALTH_ERRORS))
fi

echo ""
echo "[STEP 8/9] Installation Summary"
echo ""
echo "  Install Dir: $TARGET_DIR"
echo "  Architecture: $ARCH"
echo "  Node.js: $NODE_VERSION"
echo "  npm: $NPM_VERSION"
echo "  Errors: $ERRORS"
echo "  Warnings: $WARNINGS"
echo "  Log File: $LOG_FILE"
echo ""

echo "[STEP 9/9] Next steps"
if [[ $ERRORS -gt 0 ]]; then
    echo -e "${RED}[RESULT]${NC} Installation completed with errors"
    echo "Review $LOG_FILE for details."
else
    echo -e "${GREEN}[RESULT]${NC} Installation completed successfully"
    echo "Run: ./Launch-Unix.sh"
fi

exit $ERRORS
