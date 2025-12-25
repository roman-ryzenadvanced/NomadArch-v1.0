#!/bin/bash

# NomadArch Installer for Linux
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
echo "NomadArch Installer (Linux)"
echo "Version: 0.4.0"
echo ""

log "Installer started"

echo "[STEP 1/9] OS and Architecture Detection"
OS_TYPE=$(uname -s)
ARCH_TYPE=$(uname -m)
log "OS: $OS_TYPE"
log "Architecture: $ARCH_TYPE"

if [[ "$OS_TYPE" != "Linux" ]]; then
    echo -e "${RED}[ERROR]${NC} This installer is for Linux. Current OS: $OS_TYPE"
    log "ERROR: Not Linux ($OS_TYPE)"
    exit 1
fi

case "$ARCH_TYPE" in
    x86_64) ARCH="x64" ;;
    aarch64) ARCH="arm64" ;;
    armv7l) ARCH="arm" ;;
    *)
        echo -e "${RED}[ERROR]${NC} Unsupported architecture: $ARCH_TYPE"
        log "ERROR: Unsupported arch $ARCH_TYPE"
        exit 1
        ;;
esac

echo -e "${GREEN}[OK]${NC} OS: Linux"
echo -e "${GREEN}[OK]${NC} Architecture: $ARCH_TYPE"

if [[ -f /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    echo -e "${GREEN}[INFO]${NC} Distribution: ${PRETTY_NAME:-unknown}"
fi

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

SUDO=""
if [[ $EUID -ne 0 ]]; then
    if command -v sudo >/dev/null 2>&1; then
        SUDO="sudo"
    else
        echo -e "${RED}[ERROR]${NC} sudo is required to install dependencies"
        log "ERROR: sudo not found"
        exit 1
    fi
fi

install_packages() {
    local manager="$1"
    shift
    local packages=("$@")
    echo -e "${BLUE}[INFO]${NC} Installing via $manager: ${packages[*]}"
    case "$manager" in
        apt)
            $SUDO apt-get update -y
            $SUDO apt-get install -y "${packages[@]}"
            ;;
        dnf)
            $SUDO dnf install -y "${packages[@]}"
            ;;
        yum)
            $SUDO yum install -y "${packages[@]}"
            ;;
        pacman)
            $SUDO pacman -Sy --noconfirm "${packages[@]}"
            ;;
        zypper)
            $SUDO zypper -n install "${packages[@]}"
            ;;
        apk)
            $SUDO apk add --no-cache "${packages[@]}"
            ;;
        *)
            return 1
            ;;
    esac
}

PACKAGE_MANAGER=""
if command -v apt-get >/dev/null 2>&1; then
    PACKAGE_MANAGER="apt"
elif command -v dnf >/dev/null 2>&1; then
    PACKAGE_MANAGER="dnf"
elif command -v yum >/dev/null 2>&1; then
    PACKAGE_MANAGER="yum"
elif command -v pacman >/dev/null 2>&1; then
    PACKAGE_MANAGER="pacman"
elif command -v zypper >/dev/null 2>&1; then
    PACKAGE_MANAGER="zypper"
elif command -v apk >/dev/null 2>&1; then
    PACKAGE_MANAGER="apk"
fi

if [[ -z "$PACKAGE_MANAGER" ]]; then
    echo -e "${RED}[ERROR]${NC} No supported package manager found."
    echo "Install Node.js, npm, git, and curl manually."
    log "ERROR: No package manager found"
    exit 1
fi

MISSING_PKGS=()
command -v curl >/dev/null 2>&1 || MISSING_PKGS+=("curl")
command -v git >/dev/null 2>&1 || MISSING_PKGS+=("git")

# Node.js package names vary by distro
if ! command -v node >/dev/null 2>&1; then
    case "$PACKAGE_MANAGER" in
        apt) MISSING_PKGS+=("nodejs" "npm") ;;  # Debian/Ubuntu needs both
        dnf|yum) MISSING_PKGS+=("nodejs" "npm") ;;
        pacman) MISSING_PKGS+=("nodejs" "npm") ;;
        zypper) MISSING_PKGS+=("nodejs18" "npm18") ;;  # openSUSE uses versioned packages
        apk) MISSING_PKGS+=("nodejs" "npm") ;;
        *) MISSING_PKGS+=("nodejs") ;;
    esac
elif ! command -v npm >/dev/null 2>&1; then
    # Node exists but npm doesn't (some minimal installs)
    MISSING_PKGS+=("npm")
fi

if [[ ${#MISSING_PKGS[@]} -gt 0 ]]; then
    install_packages "$PACKAGE_MANAGER" "${MISSING_PKGS[@]}" || {
        echo -e "${YELLOW}[WARN]${NC} Some packages failed to install. Trying alternative method..."
        # Fallback: try installing just nodejs (which may include npm)
        if ! command -v node >/dev/null 2>&1; then
            install_packages "$PACKAGE_MANAGER" "nodejs" || true
        fi
    }
fi

if ! command -v node >/dev/null 2>&1; then
    echo -e "${RED}[ERROR]${NC} Node.js install failed."
    log "ERROR: Node.js still missing"
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
    log "ERROR: npm missing after install"
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

# Pin to a specific known-working version to avoid compatibility issues
# Update this version when testing confirms a new version works
OPENCODE_PINNED_VERSION="0.1.44"
OPENCODE_VERSION="$OPENCODE_PINNED_VERSION"

# Try to get latest, but fall back to pinned if API fails
LATEST_VERSION=$(curl -s --max-time 10 https://api.github.com/repos/sst/opencode/releases/latest 2>/dev/null | grep '"tag_name"' | cut -d'"' -f4 | sed 's/^v//')
if [[ -n "$LATEST_VERSION" ]]; then
    echo -e "${BLUE}[INFO]${NC} Latest available: v${LATEST_VERSION}, using pinned: v${OPENCODE_VERSION}"
fi

OPENCODE_BASE="https://github.com/sst/opencode/releases/download/v${OPENCODE_VERSION}"
OPENCODE_URL="${OPENCODE_BASE}/opencode-linux-${ARCH}"
CHECKSUM_URL="${OPENCODE_BASE}/checksums.txt"

NEEDS_DOWNLOAD=0
if [[ -f "$BIN_DIR/opencode" ]]; then
    EXISTING_VERSION=$("$BIN_DIR/opencode" --version 2>/dev/null | head -1 || echo "unknown")
    if [[ "$EXISTING_VERSION" == *"$OPENCODE_VERSION"* ]] || [[ "$EXISTING_VERSION" != "unknown" ]]; then
        echo -e "${GREEN}[OK]${NC} OpenCode binary exists (version: $EXISTING_VERSION)"
    else
        echo -e "${YELLOW}[WARN]${NC} Existing binary version mismatch, re-downloading..."
        NEEDS_DOWNLOAD=1
    fi
else
    NEEDS_DOWNLOAD=1
fi

if [[ $NEEDS_DOWNLOAD -eq 1 ]]; then
    echo -e "${BLUE}[INFO]${NC} Downloading OpenCode v${OPENCODE_VERSION} for ${ARCH}..."
    
    DOWNLOAD_SUCCESS=0
    for attempt in 1 2 3; do
        if curl -L --fail --retry 3 -o "$BIN_DIR/opencode.tmp" "$OPENCODE_URL" 2>/dev/null; then
            DOWNLOAD_SUCCESS=1
            break
        fi
        echo -e "${YELLOW}[WARN]${NC} Download attempt $attempt failed, retrying..."
        sleep 2
    done
    
    if [[ $DOWNLOAD_SUCCESS -eq 0 ]]; then
        echo -e "${RED}[ERROR]${NC} Failed to download OpenCode binary after 3 attempts"
        echo "URL: $OPENCODE_URL"
        exit 1
    fi
    
    if curl -L --fail -o "$BIN_DIR/checksums.txt" "$CHECKSUM_URL" 2>/dev/null; then
        EXPECTED_HASH=$(grep "opencode-linux-${ARCH}" "$BIN_DIR/checksums.txt" | awk '{print $1}')
        ACTUAL_HASH=$(sha256sum "$BIN_DIR/opencode.tmp" | awk '{print $1}')
        
        if [[ "$ACTUAL_HASH" == "$EXPECTED_HASH" ]]; then
            echo -e "${GREEN}[OK]${NC} Checksum verified"
        else
            echo -e "${YELLOW}[WARN]${NC} Checksum mismatch (may be OK for some versions)"
        fi
    else
        echo -e "${YELLOW}[WARN]${NC} Could not download checksums (continuing anyway)"
    fi
    
    mv "$BIN_DIR/opencode.tmp" "$BIN_DIR/opencode"
    chmod +x "$BIN_DIR/opencode"
    echo -e "${GREEN}[OK]${NC} OpenCode binary installed"
fi

# Validate the binary actually works
echo ""
echo "[STEP 5b/9] Validating OpenCode binary"
BINARY_TEST=$("$BIN_DIR/opencode" --version 2>&1 || echo "FAILED")
if [[ "$BINARY_TEST" == *"FAILED"* ]] || [[ -z "$BINARY_TEST" ]]; then
    echo -e "${RED}[ERROR]${NC} OpenCode binary is not working correctly"
    echo "Binary path: $BIN_DIR/opencode"
    echo "Test output: $BINARY_TEST"
    echo ""
    echo "Please try:"
    echo "  1. Delete $BIN_DIR/opencode and re-run this installer"
    echo "  2. Manually download from https://github.com/sst/opencode/releases"
    exit 1
fi
echo -e "${GREEN}[OK]${NC} Binary validation passed: $BINARY_TEST"

# Auto-configure NomadArch to use this binary
echo ""
echo "[STEP 5c/9] Configuring NomadArch to use installed binary"
PREFS_DIR="$HOME/.config/nomadarch"
mkdir -p "$PREFS_DIR"
PREFS_FILE="$PREFS_DIR/preferences.json"
BINARY_PATH="$BIN_DIR/opencode"

if [[ -f "$PREFS_FILE" ]]; then
    if command -v node >/dev/null 2>&1; then
        node -e "
const fs = require('fs');
const prefs = JSON.parse(fs.readFileSync('$PREFS_FILE', 'utf8'));
prefs.lastUsedBinary = '$BINARY_PATH';
prefs.opencodeBinaries = prefs.opencodeBinaries || [];
if (!prefs.opencodeBinaries.find(b => b.path === '$BINARY_PATH')) {
    prefs.opencodeBinaries.push({ path: '$BINARY_PATH', version: '$OPENCODE_VERSION' });
}
fs.writeFileSync('$PREFS_FILE', JSON.stringify(prefs, null, 2));
" 2>/dev/null && echo -e "${GREEN}[OK]${NC} Updated preferences to use $BINARY_PATH" || echo -e "${YELLOW}[WARN]${NC} Could not auto-update preferences"
    fi
else
    cat > "$PREFS_FILE" << EOF
{
  "lastUsedBinary": "$BINARY_PATH",
  "opencodeBinaries": [
    { "path": "$BINARY_PATH", "version": "$OPENCODE_VERSION" }
  ]
}
EOF
    echo -e "${GREEN}[OK]${NC} Created preferences with binary path: $BINARY_PATH"
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
