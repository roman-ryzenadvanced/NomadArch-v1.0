#!/bin/bash

echo ""
echo "  ███╗   ██╗ ██████╗ ███╗   ███╗ █████╗ ██████╗  █████╗ ██████╗  ██████╗██╗  ██╗"
echo "  ████╗  ██║██╔═══██╗████╗ ████║██╔══██╗██╔══██╗██╔══██╗██╔════╝██║  ██║"
echo "  ██╔██╗ ██║██║   ██║██╔████╔██║███████║██║  ██║███████║██████╔╝██║     ███████║"
echo "  ██║╚██╗██║██║   ██║██║╚██╔╝██║██╔══██║██║  ██║██╔══██║██╔══██╗██║     ██╔══██║"
echo "  ██║ ╚████║╚██████╔╝██║ ╚═╝ ██║██║  ██║██████╔╝██║  ██║██║  ██║╚██████╗██║  ██║"
echo "  ╚═╝  ╚═══╝ ╚═════╝ ╚═╝     ╚═╝╚═╝  ╚═╝╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝"
echo ""
echo "  INSTALLER - macOS Enhanced with Auto-Dependency Resolution"
echo "  ═══════════════════════════════════════════════════════════════════════════"
echo ""

ERRORS=0
WARNINGS=0

cd "$(dirname "$0")"

echo "[STEP 1/7] Checking macOS Version..."
echo ""

if [ -f /System/Library/CoreServices/SystemVersion.plist ]; then
    MAC_VERSION=$(defaults read /System/Library/CoreServices/SystemVersion.plist ProductVersion)
    MAC_MAJOR=$(echo $MAC_VERSION | cut -d. -f1)
    echo "[OK] macOS detected: $MAC_VERSION"

    if [ "$MAC_MAJOR" -lt 11 ]; then
        echo "[WARN] NomadArch requires macOS 11+ (Big Sur or later)"
        echo "[INFO] Your version is $MAC_VERSION"
        echo "[INFO] Please upgrade macOS to continue"
        exit 1
    fi
else
    echo "[WARN] Could not detect macOS version"
    WARNINGS=$((WARNINGS + 1))
fi

ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
    echo "[OK] Apple Silicon detected (M1/M2/M3 chip)"
elif [ "$ARCH" = "x86_64" ]; then
    echo "[OK] Intel Mac detected"
else
    echo "[WARN] Unknown architecture: $ARCH"
    WARNINGS=$((WARNINGS + 1))
fi

echo ""
echo "[STEP 2/7] Checking System Requirements..."
echo ""

if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js not found!"
    echo ""
    echo "NomadArch requires Node.js to run."
    echo ""
    echo "Install Node.js using one of these methods:"
    echo ""
    echo "  1. Homebrew (recommended):"
    echo "     brew install node"
    echo ""
    echo "  2. Download from official site:"
    echo "     Visit https://nodejs.org/"
    echo "     Download and install macOS installer"
    echo ""
    echo "  3. Using NVM (Node Version Manager):"
    echo "     curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash"
    echo "     source ~/.zshrc  (or ~/.bash_profile)"
    echo "     nvm install 20"
    echo ""
    exit 1
fi

NODE_VERSION=$(node --version)
echo "[OK] Node.js detected: $NODE_VERSION"

NODE_MAJOR=$(echo $NODE_VERSION | cut -d. -f1 | sed 's/v//')
if [ "$NODE_MAJOR" -lt 18 ]; then
    echo "[WARN] Node.js version is too old (found v$NODE_VERSION, required 18+)"
    echo "[INFO] Please update Node.js: brew upgrade node"
    WARNINGS=$((WARNINGS + 1))
fi

if ! command -v npm &> /dev/null; then
    echo "[ERROR] npm not found! This should come with Node.js."
    echo "Please reinstall Node.js"
    ERRORS=$((ERRORS + 1))
fi

NPM_VERSION=$(npm --version)
echo "[OK] npm detected: $NPM_VERSION"

echo "[INFO] Checking Xcode Command Line Tools..."
if ! command -v xcode-select &> /dev/null; then
    echo "[WARN] Xcode Command Line Tools not installed"
    echo "[INFO] Required for building native Node.js modules"
    echo ""
    echo "Install by running:"
    echo "  xcode-select --install"
    echo ""
    echo "This will open a dialog to install the tools."
    WARNINGS=$((WARNINGS + 1))
else
    XCODE_PATH=$(xcode-select -p)
    echo "[OK] Xcode Command Line Tools detected: $XCODE_PATH"
fi

echo ""
echo "[STEP 3/7] Checking OpenCode CLI..."
echo ""

if command -v opencode &> /dev/null; then
    echo "[OK] OpenCode is already installed globally"
    OPENCODE_DONE=true
elif [ -f "bin/opencode" ]; then
    echo "[OK] OpenCode binary found in bin/ folder"
    OPENCODE_DONE=true
else
    OPENCODE_DONE=false
fi

if [ "$OPENCODE_DONE" = false ]; then
    echo "[SETUP] OpenCode CLI not found. Installing..."
    echo ""
    echo "[INFO] Attempting to install OpenCode via npm..."
    npm install -g opencode-ai@latest
    if [ $? -eq 0 ]; then
        echo "[SUCCESS] OpenCode installed successfully via npm"
        if command -v opencode &> /dev/null; then
            echo "[OK] OpenCode is now available in system PATH"
            OPENCODE_DONE=true
        fi
    else
        echo "[WARN] npm install failed, trying fallback method..."
        echo ""

        if [ ! -d "bin" ]; then
            mkdir bin
        fi

        if [ "$ARCH" = "arm64" ]; then
            FILENAME="opencode-darwin-arm64.zip"
        elif [ "$ARCH" = "x86_64" ]; then
            FILENAME="opencode-darwin-x64.zip"
        else
            echo "[WARN] Unsupported architecture: $ARCH"
            WARNINGS=$((WARNINGS + 1))
            FILENAME=""
        fi

        if [ -n "$FILENAME" ]; then
            echo "[SETUP] Downloading OpenCode from GitHub releases..."
            curl -L -o "opencode.zip" "https://github.com/sst/opencode/releases/latest/download/$FILENAME"
            if [ $? -ne 0 ]; then
                echo "[ERROR] Failed to download OpenCode from GitHub!"
                echo "[INFO] You can install OpenCode CLI manually from: https://opencode.ai/"
                WARNINGS=$((WARNINGS + 1))
            else
                echo "[OK] Downloaded OpenCode ZIP"
                echo "[SETUP] Extracting OpenCode binary..."

                unzip -q "opencode.zip" -d "opencode-temp"
                if [ -f "opencode-temp/opencode" ]; then
                    mv "opencode-temp/opencode" "bin/opencode"
                    chmod +x "bin/opencode"
                    echo "[OK] OpenCode binary placed in bin/ folder"
                else
                    echo "[ERROR] opencode binary not found in extracted files!"
                    WARNINGS=$((WARNINGS + 1))
                fi

                rm -f "opencode.zip"
                rm -rf "opencode-temp"
            fi
        fi
    fi
fi

echo ""
echo "[STEP 4/7] Installing NomadArch Dependencies..."
echo ""

if [ -d "node_modules" ]; then
    echo "[INFO] node_modules found. Skipping dependency installation."
    echo "[INFO] To force reinstall, delete node_modules and run again."
    goto :BUILD_CHECK
fi

echo "[INFO] Installing root dependencies..."
npm install
if [ $? -ne 0 ]; then
    echo "[ERROR] Failed to install root dependencies!"
    ERRORS=$((ERRORS + 1))
fi

echo "[INFO] Installing package dependencies..."

if [ -d "packages/server" ]; then
    echo "[INFO] Installing server dependencies..."
    cd packages/server
    npm install
    if [ $? -ne 0 ]; then
        echo "[WARN] Failed to install server dependencies!"
        WARNINGS=$((WARNINGS + 1))
    else
        echo "[OK] Server dependencies installed"
    fi
    cd ../..
fi

if [ -d "packages/ui" ]; then
    echo "[INFO] Installing UI dependencies..."
    cd packages/ui
    npm install
    if [ $? -ne 0 ]; then
        echo "[WARN] Failed to install UI dependencies!"
        WARNINGS=$((WARNINGS + 1))
    else
        echo "[OK] UI dependencies installed"
    fi
    cd ../..
fi

if [ -d "packages/electron-app" ]; then
    echo "[INFO] Installing Electron app dependencies..."
    cd packages/electron-app
    npm install
    if [ $? -ne 0 ]; then
        echo "[WARN] Failed to install Electron app dependencies!"
        WARNINGS=$((WARNINGS + 1))
    else
        echo "[OK] Electron app dependencies installed"
    fi
    cd ../..
fi

echo ""
echo "[STEP 5/7] Setting Permissions..."
echo ""

chmod +x Launch-Unix.sh 2>/dev/null
chmod +x Install-Linux.sh 2>/dev/null
chmod +x Install-Mac.sh 2>/dev/null

echo "[OK] Scripts permissions set"

echo ""
echo "[STEP 6/7] Checking for Existing Build..."
echo ""

if [ -d "packages/ui/dist" ]; then
    echo "[OK] UI build found. Skipping build step."
    echo "[INFO] To rebuild, delete packages/ui/dist and run installer again."
    goto :INSTALL_REPORT
fi

echo "[INFO] No UI build found. Building UI..."
echo ""

cd packages/ui
npm run build
if [ $? -ne 0 ]; then
    echo "[WARN] Failed to build UI!"
    WARNINGS=$((WARNINGS + 1))
    echo "[INFO] You can build manually later by running: cd packages/ui && npm run build"
fi
cd ../..

echo ""
echo "[STEP 7/7] Testing Installation..."
echo ""

node --version >nul 2>&1
if [ $? -eq 0 ]; then
    echo "[OK] Node.js is working"
else
    echo "[FAIL] Node.js is not working correctly"
    ERRORS=$((ERRORS + 1))
fi

npm --version >nul 2>&1
if [ $? -eq 0 ]; then
    echo "[OK] npm is working"
else
    echo "[FAIL] npm is not working correctly"
    ERRORS=$((ERRORS + 1))
fi

if command -v opencode &> /dev/null; then
    echo "[OK] OpenCode CLI is available"
elif [ -f "bin/opencode" ]; then
    echo "[OK] OpenCode binary found in bin/ folder"
else
    echo "[FAIL] OpenCode CLI not available"
    WARNINGS=$((WARNINGS + 1))
fi

echo ""
echo "Installation Summary"
echo ""

if [ $ERRORS -gt 0 ]; then
    echo ""
    echo "════════════════════════════════════════════════════════════════════════════"
    echo "[FAILED] Installation encountered $ERRORS error(s)!"
    echo ""
    echo "Please review error messages above and try again."
    echo "For help, see: https://github.com/roman-ryzenadvanced/NomadArch-v1.0/issues"
    echo "════════════════════════════════════════════════════════════════════════════"
    echo ""
    exit 1
fi

echo ""
echo "════════════════════════════════════════════════════════════════════════════"
echo "[SUCCESS] Installation Complete!"
echo ""

if [ $WARNINGS -gt 0 ]; then
    echo "[WARN] There were $WARNINGS warning(s) during installation."
    echo "Review warnings above. Most warnings are non-critical."
    echo ""
fi

echo "You can now run NomadArch using:"
echo "  ./Launch-Unix.sh"
echo ""
echo "For help and documentation, see: README.md"
echo "════════════════════════════════════════════════════════════════════════════"
echo ""
