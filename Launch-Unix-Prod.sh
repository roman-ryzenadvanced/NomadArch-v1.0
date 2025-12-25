#!/bin/bash

# NomadArch Production Launcher for macOS and Linux
# Version: 0.4.0

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "NomadArch Launcher (macOS/Linux, Production Mode)"
echo "Version: 0.4.0"
echo "Features: SMART FIX / APEX / SHIELD / MULTIX MODE"
echo ""

echo "[STEP 1/3] Checking Dependencies..."

if ! command -v node &> /dev/null; then
    echo -e "${RED}[ERROR]${NC} Node.js not found!"
    echo "Please run the installer first:"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "  ./Install-Mac.sh"
    else
        echo "  ./Install-Linux.sh"
    fi
    exit 1
fi

NODE_VERSION=$(node --version)
echo -e "${GREEN}[OK]${NC} Node.js: $NODE_VERSION"

echo ""
echo "[STEP 2/3] Checking Pre-Built UI..."

if [[ -d "packages/electron-app/dist/renderer/assets" ]]; then
    echo -e "${GREEN}[OK]${NC} Pre-built UI assets found"
else
    echo -e "${RED}[ERROR]${NC} Pre-built UI assets not found."
    echo "Run: npm run build"
    exit 1
fi

echo ""
echo "[STEP 3/3] Starting NomadArch (Production Mode)..."

cd packages/electron-app
npx electron .
EXIT_CODE=$?

if [[ $EXIT_CODE -ne 0 ]]; then
    echo ""
    echo -e "${RED}[ERROR]${NC} NomadArch exited with an error!"
fi

exit $EXIT_CODE
