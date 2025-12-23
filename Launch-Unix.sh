#!/bin/bash

echo ""
echo "  ███╗   ██╗ ██████╗ ███╗   ███╗ █████╗ ██████╗  █████╗ ██████╗  ██████╗██╗  ██╗"
echo "  ████╗  ██║██╔═══██╗████╗ ████║██╔══██╗██╔══██╗██╔══██╗██╔════╝██║  ██║"
echo "  ██╔██╗ ██║██║   ██║██╔████╔██║███████║██║  ██║███████║██████╔╝██║     ███████║"
echo "  ██║╚██╗██║██║   ██║██║╚██╔╝██║██╔══██║██║  ██║██╔══██║██╔══██╗██║     ██╔══██║"
echo "  ██║ ╚████║╚██████╔╝██║ ╚═╝ ██║██║  ██║██████╔╝██║  ██║██║  ██║╚██████╗██║  ██║"
echo "  ╚═╝  ╚═══╝ ╚═════╝ ╚═╝     ╚═╝╚═╝  ╚═╝╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝"
echo ""
echo "  LAUNCHER - Linux/macOS"
echo "  ═════════════════════════════════════════════════════════════════════════════"
echo ""

ERRORS=0
WARNINGS=0

cd "$(dirname "$0")"

echo "[STEP 1/5] Checking Dependencies..."
echo ""

if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js not found!"
    echo ""
    echo "Please install Node.js first: https://nodejs.org/"
    echo "Then run: ./Install-Linux.sh (or ./Install-Mac.sh on macOS)"
    echo ""
    exit 1
fi

NODE_VERSION=$(node --version)
echo "[OK] Node.js: $NODE_VERSION"

if ! command -v npm &> /dev/null; then
    echo "[ERROR] npm not found!"
    echo ""
    exit 1
fi

NPM_VERSION=$(npm --version)
echo "[OK] npm: $NPM_VERSION"

echo ""
echo "[STEP 2/5] Checking for OpenCode CLI..."
echo ""

if command -v opencode &> /dev/null; then
    echo "[OK] OpenCode is available in PATH"
elif [ -f "bin/opencode" ]; then
    echo "[OK] OpenCode binary found in bin/ folder"
else
    echo "[WARN] OpenCode CLI not found"
    echo "[INFO] Run ./Install-Linux.sh (or ./Install-Mac.sh on macOS) to install OpenCode"
    WARNINGS=$((WARNINGS + 1))
fi

echo ""
echo "[STEP 3/5] Checking for Existing Build..."
echo ""

if [ -d "packages/ui/dist" ]; then
    echo "[OK] UI build found"
else
    echo "[WARN] No UI build found. Building now..."
    echo ""
    cd packages/ui
    npm run build
    if [ $? -ne 0 ]; then
        echo "[ERROR] UI build failed!"
        ERRORS=$((ERRORS + 1))
    else
        echo "[OK] UI build completed"
    fi
    cd ../..
fi

echo ""
echo "[STEP 4/5] Checking Port Availability..."
echo ""

SERVER_PORT=3001
UI_PORT=3000

if lsof -Pi :$SERVER_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "[WARN] Port $SERVER_PORT is already in use"
    echo "[INFO] Another NomadArch instance or app may be running"
    echo "[INFO] To find the process: lsof -i :$SERVER_PORT"
    echo "[INFO] To kill it: kill -9 \$(lsof -t -i:$SERVER_PORT)"
    WARNINGS=$((WARNINGS + 1))
else
    echo "[OK] Port $SERVER_PORT is available"
fi

if lsof -Pi :$UI_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "[WARN] Port $UI_PORT is already in use"
    echo "[INFO] To find the process: lsof -i :$UI_PORT"
    echo "[INFO] To kill it: kill -9 \$(lsof -t -i:$UI_PORT)"
    WARNINGS=$((WARNINGS + 1))
else
    echo "[OK] Port $UI_PORT is available"
fi

echo ""
echo "[STEP 5/5] Starting NomadArch..."
echo ""

if [ $ERRORS -gt 0 ]; then
    echo "[ERROR] Cannot start due to errors!"
    echo ""
    exit 1
fi

echo "[INFO] Starting NomadArch..."
echo "[INFO] Server will run on http://localhost:$SERVER_PORT"
echo "[INFO] Press Ctrl+C to stop"
echo ""

npm run dev:electron

if [ $? -ne 0 ]; then
    echo ""
    echo "[ERROR] NomadArch exited with an error!"
    echo ""
    echo "Common solutions:"
    echo "  1. Check that all dependencies are installed: npm install"
    echo "  2. Check that the UI is built: cd packages/ui && npm run build"
    echo "  3. Check for port conflicts (see warnings above)"
    echo "  4. Check the error message above for details"
    echo ""
    echo "To reinstall everything: ./Install-Linux.sh (or ./Install-Mac.sh on macOS)"
    echo ""
fi
