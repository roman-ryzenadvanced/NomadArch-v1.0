@echo off
title NomadArch Installer
color 0A
setlocal enabledelayedexpansion

echo.
echo  ███╗   ██╗ ██████╗ ███╗   ███╗ █████╗ ██████╗  █████╗ ██████╗  ██████╗██╗  ██╗
echo  ████╗  ██║██╔═══██╗████╗ ████║██╔══██╗██╔══██╗██╔══██╗██╔════╝██║  ██║
echo  ██╔██╗ ██║██║   ██║██╔████╔██║███████║██║  ██║███████║██████╔╝██║     ███████║
echo  ██║╚██╗██║██║   ██║██║╚██╔╝██║██╔══██║██║  ██║██╔══██║██╔══██╗██║     ██╔══██║
echo  ██║ ╚████║╚██████╔╝██║ ╚═╝ ██║██║  ██║██████╔╝██║  ██║██║  ██║╚██████╗██║  ██║
echo  ╚═╝  ╚═══╝ ╚═════╝ ╚═╝     ╚═╝╚═╝  ╚═╝╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝
echo.
echo  INSTALLER - Enhanced with Auto-Dependency Resolution
echo  ═══════════════════════════════════════════════════════════════════════════════
echo.

set ERRORS=0
set WARNINGS=0

cd /d "%~dp0"

echo [STEP 1/6] Checking System Requirements...
echo.

:: Check for Administrator privileges
net session >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [WARN] Not running as Administrator. Some operations may fail.
    set /a WARNINGS+=1
    echo.
)

:: Check for Node.js
echo [INFO] Checking Node.js...
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js not found!
    echo.
    echo NomadArch requires Node.js to run.
    echo.
    echo Download from: https://nodejs.org/
    echo Recommended: Node.js 18.x LTS or 20.x LTS
    echo.
    echo Opening download page...
    start "" "https://nodejs.org/"
    echo.
    echo Please install Node.js and run this installer again.
    echo.
    pause
    exit /b 1
)

:: Display Node.js version
for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo [OK] Node.js found: %NODE_VERSION%

:: Check for npm
echo [INFO] Checking npm...
where npm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm not found!
    echo.
    echo npm is required for dependency management.
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('npm --version') do set NPM_VERSION=%%i
echo [OK] npm found: %NPM_VERSION%

echo.
echo [STEP 2/6] Checking OpenCode CLI...
echo.

:: Check if opencode is already installed globally
where opencode >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [OK] OpenCode is already installed globally
    goto :OPENCODE_DONE
)

:: Check if opencode exists in bin/ folder
if exist "bin\opencode.exe" (
    echo [OK] OpenCode binary found in bin/ folder
    goto :OPENCODE_DONE
)

:: Install OpenCode CLI
echo [SETUP] OpenCode CLI not found. Installing...
echo.
echo [INFO] Attempting to install OpenCode via npm...
call npm install -g opencode-ai@latest
if %ERRORLEVEL% equ 0 (
    echo [SUCCESS] OpenCode installed successfully via npm
    where opencode >nul 2>&1
    if %ERRORLEVEL% equ 0 (
        echo [OK] OpenCode is now available in system PATH
        goto :OPENCODE_DONE
    )
)

echo [WARN] npm install failed or not in PATH, trying fallback method...
echo.

:: Fallback: Download from GitHub releases
echo [SETUP] Downloading OpenCode from GitHub releases...
echo.

:: Download Windows x64 ZIP
curl -L -o "opencode-windows-x64.zip" "https://github.com/sst/opencode/releases/latest/download/opencode-windows-x64.zip"
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to download OpenCode from GitHub!
    set /a ERRORS+=1
    goto :INSTALL_DEPS
)

echo [OK] Downloaded OpenCode ZIP
echo [SETUP] Extracting OpenCode binary...

:: Create bin directory if not exists
if not exist "bin" mkdir bin

:: Extract using PowerShell
powershell -Command "Expand-Archive -Path 'opencode-windows-x64.zip' -DestinationPath 'opencode-temp' -Force"
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to extract OpenCode!
    set /a ERRORS+=1
    goto :CLEANUP
)

:: Move opencode.exe to bin/ folder
if exist "opencode-temp\opencode.exe" (
    move /Y "opencode-temp\opencode.exe" "bin\opencode.exe" >nul
    echo [OK] OpenCode binary placed in bin/ folder
) else (
    echo [ERROR] opencode.exe not found in extracted files!
    set /a ERRORS+=1
)

:CLEANUP
if exist "opencode-windows-x64.zip" del "opencode-windows-x64.zip"
if exist "opencode-temp" rmdir /s /q "opencode-temp"

:OPENCODE_DONE
echo.

echo [STEP 3/6] Installing NomadArch Dependencies...
echo.

:: Check if node_modules exists
if exist "node_modules" (
    echo [INFO] node_modules found. Skipping dependency installation.
    echo [INFO] To force reinstall, delete node_modules and run again.
    goto :BUILD_CHECK
)

echo [INFO] Installing root dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to install root dependencies!
    set /a ERRORS+=1
    goto :INSTALL_REPORT
)

echo [OK] Root dependencies installed
echo.

echo [INFO] Installing package dependencies...

:: Install server dependencies
if exist "packages\server" (
    echo [INFO] Installing server dependencies...
    cd packages\server
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo [WARN] Failed to install server dependencies!
        set /a WARNINGS+=1
    ) else (
        echo [OK] Server dependencies installed
    )
    cd ..\..
)

:: Install UI dependencies
if exist "packages\ui" (
    echo [INFO] Installing UI dependencies...
    cd packages\ui
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo [WARN] Failed to install UI dependencies!
        set /a WARNINGS+=1
    ) else (
        echo [OK] UI dependencies installed
    )
    cd ..\..
)

:: Install Electron app dependencies
if exist "packages\electron-app" (
    echo [INFO] Installing Electron app dependencies...
    cd packages\electron-app
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo [WARN] Failed to install Electron app dependencies!
        set /a WARNINGS+=1
    ) else (
        echo [OK] Electron app dependencies installed
    )
    cd ..\..
)

:BUILD_CHECK
echo.

echo [STEP 4/6] Checking for Existing Build...
echo.

if exist "packages\ui\dist" (
    echo [OK] UI build found. Skipping build step.
    echo [INFO] To rebuild, delete packages\ui\dist and run installer again.
    goto :INSTALL_REPORT
)

echo [INFO] No UI build found. Building UI...
echo.

:: Build UI
cd packages\ui
call npm run build
if %ERRORLEVEL% neq 0 (
    echo [WARN] Failed to build UI!
    set /a WARNINGS+=1
    echo [INFO] You can build manually later by running: cd packages\ui ^&^& npm run build
)
cd ..\..

:INSTALL_REPORT
echo.
echo ═══════════════════════════════════════════════════════════════════════════════
echo                           INSTALLATION COMPLETE
echo ═══════════════════════════════════════════════════════════════════════════════
echo.
echo  Summary:
echo.
if %ERRORS% equ 0 (
    echo  ✓ No errors encountered
) else (
    echo  ✗ %ERRORS% error(s) encountered
)
echo.
if %WARNINGS% equ 0 (
    echo  ✓ No warnings
) else (
    echo  ⚠ %WARNINGS% warning(s) encountered
)
echo.

echo [STEP 5/6] Testing Installation...
echo.

:: Test node command
node --version >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [OK] Node.js is working
) else (
    echo [FAIL] Node.js is not working correctly
    set /a ERRORS+=1
)

:: Test npm command
npm --version >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [OK] npm is working
) else (
    echo [FAIL] npm is not working correctly
    set /a ERRORS+=1
)

:: Test opencode command
where opencode >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [OK] OpenCode CLI is available
) else (
    if exist "bin\opencode.exe" (
        echo [OK] OpenCode binary found in bin/ folder
    ) else (
        echo [FAIL] OpenCode CLI not available
        set /a WARNINGS+=1
    )
)

echo.
echo [STEP 6/6] Next Steps...
echo.
echo  To start NomadArch:
echo    1. Double-click and run: Launch-Windows.bat
echo  OR
echo    2. Run from command line: npm run dev:electron
echo.
echo  For development mode:
echo    Run: Launch-Dev-Windows.bat
echo.

if %ERRORS% gtr 0 (
    echo  ⚠ INSTALLATION HAD ERRORS!
    echo  Please review the messages above and fix any issues.
    echo.
    pause
    exit /b 1
) else (
    echo  ✓ Installation completed successfully!
    echo.
    echo  Press any key to exit...
    pause >nul
    exit /b 0
)
