#!/bin/bash

# NomadArch Launcher for macOS and Linux
# Version: 0.4.0

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ERRORS=0
WARNINGS=0
AUTO_FIXED=0

echo ""
echo "NomadArch Launcher (macOS/Linux)"
echo "Version: 0.4.0"
echo ""

echo "[PREFLIGHT 1/7] Checking Dependencies..."

if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}[WARN]${NC} Node.js not found. Running installer..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        bash "$SCRIPT_DIR/Install-Mac.sh"
    else
        bash "$SCRIPT_DIR/Install-Linux.sh"
    fi
    echo -e "${BLUE}[INFO]${NC} If Node.js was installed, open a new terminal and run Launch-Unix.sh again."
    exit 1
fi

NODE_VERSION=$(node --version)
echo -e "${GREEN}[OK]${NC} Node.js: $NODE_VERSION"

if ! command -v npm &> /dev/null; then
    echo -e "${RED}[ERROR]${NC} npm not found!"
    exit 1
fi

NPM_VERSION=$(npm --version)
echo -e "${GREEN}[OK]${NC} npm: $NPM_VERSION"

echo ""
echo "[PREFLIGHT 2/7] Checking for OpenCode CLI..."

if command -v opencode &> /dev/null; then
    echo -e "${GREEN}[OK]${NC} OpenCode CLI available in PATH"
elif [[ -f "$SCRIPT_DIR/bin/opencode" ]]; then
    echo -e "${GREEN}[OK]${NC} OpenCode binary found in bin/"
else
    echo -e "${YELLOW}[WARN]${NC} OpenCode CLI not found"
    echo "[INFO] Run Install-*.sh to set up OpenCode"
    ((WARNINGS++))
fi

echo ""
echo "[PREFLIGHT 3/7] Checking Dependencies..."

if [[ ! -d "node_modules" ]]; then
    echo -e "${YELLOW}[INFO]${NC} Dependencies not installed. Installing now..."
    if ! npm install; then
        echo -e "${RED}[ERROR]${NC} Dependency installation failed!"
        exit 1
    fi
    echo -e "${GREEN}[OK]${NC} Dependencies installed (auto-fix)"
    ((AUTO_FIXED++))
else
    echo -e "${GREEN}[OK]${NC} Dependencies found"
fi

echo ""
echo "[PREFLIGHT 4/7] Finding Available Port..."

DEFAULT_SERVER_PORT=3001
DEFAULT_UI_PORT=3000
SERVER_PORT=$DEFAULT_SERVER_PORT
UI_PORT=$DEFAULT_UI_PORT

for port in {3001..3050}; do
    # Try lsof first, then ss, then netstat
    if command -v lsof &> /dev/null; then
        if ! lsof -i :$port -sTCP:LISTEN -t > /dev/null 2>&1; then
            SERVER_PORT=$port
            break
        fi
    elif command -v ss &> /dev/null; then
        if ! ss -tuln | grep -q ":$port "; then
            SERVER_PORT=$port
            break
        fi
    elif command -v netstat &> /dev/null; then
        if ! netstat -tuln | grep -q ":$port "; then
            SERVER_PORT=$port
            break
        fi
    else
        # No port checking tools, just use default
        SERVER_PORT=$port
        break
    fi
done

echo -e "${GREEN}[OK]${NC} Server port: $SERVER_PORT"

echo ""
echo "[PREFLIGHT 5/7] Final Checks..."

if [[ ! -d "packages/ui/dist" ]]; then
    echo -e "${YELLOW}[WARN]${NC} UI build directory not found"
    echo -e "${YELLOW}[INFO]${NC} Running UI build..."
    pushd packages/ui >/dev/null
    if ! npm run build; then
        echo -e "${RED}[ERROR]${NC} UI build failed!"
        popd >/dev/null
        ((ERRORS++))
    else
        popd >/dev/null
        echo -e "${GREEN}[OK]${NC} UI build completed (auto-fix)"
        ((AUTO_FIXED++))
    fi
else
    echo -e "${GREEN}[OK]${NC} UI build directory exists"
fi

if [[ ! -f "packages/electron-app/dist/main/main.js" ]]; then
    echo -e "${YELLOW}[WARN]${NC} Electron build incomplete"
    echo -e "${YELLOW}[INFO]${NC} Running full build..."
    if ! npm run build; then
        echo -e "${RED}[ERROR]${NC} Full build failed!"
        ((ERRORS++))
    else
        echo -e "${GREEN}[OK]${NC} Full build completed (auto-fix)"
        ((AUTO_FIXED++))
    fi
else
    echo -e "${GREEN}[OK]${NC} Electron build exists"
fi

echo ""
echo "[PREFLIGHT 6/7] Launch Summary"

echo -e "${BLUE}[STATUS]${NC}"
echo ""
echo "  Node.js: $NODE_VERSION"
echo "  npm: $NPM_VERSION"
echo "  Auto-fixes applied: $AUTO_FIXED"
echo "  Warnings: $WARNINGS"
echo "  Errors: $ERRORS"
echo "  Server Port: $SERVER_PORT"
echo ""

if [[ $ERRORS -gt 0 ]]; then
    echo -e "${RED}[RESULT]${NC} Cannot start due to errors!"
    exit 1
fi

echo -e "${GREEN}[INFO]${NC} Starting NomadArch..."
echo -e "${GREEN}[INFO]${NC} Server will run on http://localhost:$SERVER_PORT"
echo -e "${YELLOW}[INFO]${NC} Press Ctrl+C to stop"
echo ""

SERVER_URL="http://localhost:$SERVER_PORT"

if [[ "$OSTYPE" == "darwin"* ]]; then
    open "$SERVER_URL" 2>/dev/null || true
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    xdg-open "$SERVER_URL" 2>/dev/null || true
fi

export CLI_PORT=$SERVER_PORT
npm run dev:electron

EXIT_CODE=$?

if [[ $EXIT_CODE -ne 0 ]]; then
    echo ""
    echo -e "${RED}[ERROR]${NC} NomadArch exited with an error!"
fi

exit $EXIT_CODE
