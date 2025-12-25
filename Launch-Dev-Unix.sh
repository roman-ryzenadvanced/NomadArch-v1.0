#!/bin/bash

# NomadArch Development Launcher for macOS and Linux
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
echo "NomadArch Development Launcher (macOS/Linux)"
echo "Version: 0.4.0"
echo ""

echo "[PREFLIGHT 1/6] Checking Dependencies..."

if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}[WARN]${NC} Node.js not found. Running installer..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        bash "$SCRIPT_DIR/Install-Mac.sh"
    else
        bash "$SCRIPT_DIR/Install-Linux.sh"
    fi
    echo -e "${BLUE}[INFO]${NC} If Node.js was installed, open a new terminal and run Launch-Dev-Unix.sh again."
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
echo "[PREFLIGHT 2/6] Installing dependencies if needed..."

if [[ ! -d "node_modules" ]]; then
    echo -e "${YELLOW}[INFO]${NC} Dependencies not installed. Installing now..."
    npm install
    echo -e "${GREEN}[OK]${NC} Dependencies installed (auto-fix)"
    ((AUTO_FIXED++))
fi

echo ""
echo "[PREFLIGHT 3/6] Finding Available Ports..."

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
        SERVER_PORT=$port
        break
    fi
done

for port in {3000..3050}; do
    # Try lsof first, then ss, then netstat
    if command -v lsof &> /dev/null; then
        if ! lsof -i :$port -sTCP:LISTEN -t > /dev/null 2>&1; then
            UI_PORT=$port
            break
        fi
    elif command -v ss &> /dev/null; then
        if ! ss -tuln | grep -q ":$port "; then
            UI_PORT=$port
            break
        fi
    elif command -v netstat &> /dev/null; then
        if ! netstat -tuln | grep -q ":$port "; then
            UI_PORT=$port
            break
        fi
    else
        UI_PORT=$port
        break
    fi
done

echo -e "${GREEN}[OK]${NC} Server port: $SERVER_PORT"
echo -e "${GREEN}[OK]${NC} UI port: $UI_PORT"

echo ""
echo "[PREFLIGHT 4/6] Launch Summary"

echo -e "${BLUE}[STATUS]${NC}"
echo ""
echo "  Node.js: $NODE_VERSION"
echo "  npm: $NPM_VERSION"
echo "  Auto-fixes applied: $AUTO_FIXED"
echo "  Warnings: $WARNINGS"
echo "  Errors: $ERRORS"
echo "  Server Port: $SERVER_PORT"
echo "  UI Port: $UI_PORT"
echo ""

echo ""
echo "[PREFLIGHT 5/6] Starting services..."
echo ""

export CLI_PORT=$SERVER_PORT
export VITE_PORT=$UI_PORT

echo -e "${GREEN}[INFO]${NC} Starting backend server..."
nohup bash -c "cd '$SCRIPT_DIR/packages/server' && npm run dev" >/dev/null 2>&1 &

sleep 2

echo -e "${GREEN}[INFO]${NC} Starting UI server..."
nohup bash -c "cd '$SCRIPT_DIR/packages/ui' && npm run dev -- --port $UI_PORT" >/dev/null 2>&1 &

sleep 2

echo -e "${GREEN}[INFO]${NC} Starting Electron app..."
npm run dev:electron

echo ""
echo "[PREFLIGHT 6/6] Done."
