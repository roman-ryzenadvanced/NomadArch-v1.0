@echo off
title NomadArch Launcher
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
echo  LAUNCHER - Enhanced with Auto-Fix Capabilities
echo  ═════════════════════════════════════════════════════════════════════════════
echo.

cd /d "%~dp0"

set ERRORS=0
set WARNINGS=0

echo [STEP 1/5] Checking Dependencies...
echo.

where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js not found!
    echo.
    echo Please install Node.js first: https://nodejs.org/
    echo Then run: Install-Windows.bat
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo [OK] Node.js: %NODE_VERSION%

where npm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm not found!
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('npm --version') do set NPM_VERSION=%%i
echo [OK] npm: %NPM_VERSION%

echo.
echo [STEP 2/5] Checking for OpenCode CLI...
echo.

where opencode >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [OK] OpenCode is available in PATH
) else (
    if exist "bin\opencode.exe" (
        echo [OK] OpenCode binary found in bin/ folder
    ) else (
        echo [WARN] OpenCode CLI not found
        echo [INFO] Run Install-Windows.bat to install OpenCode
        set /a WARNINGS+=1
    )
)

echo.
echo [STEP 3/5] Checking for Existing Build...
echo.

if exist "packages\ui\dist" (
    echo [OK] UI build found
) else (
    echo [WARN] No UI build found. Building now...
    echo.
    cd packages\ui
    call npm run build
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] UI build failed!
        set /a ERRORS+=1
    ) else (
        echo [OK] UI build completed
    )
    cd ..\..
)

echo.
echo [STEP 4/5] Checking Port Availability...
echo.

set SERVER_PORT=3001
set UI_PORT=3000

netstat -ano | findstr ":%SERVER_PORT%" | findstr "LISTENING" >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [WARN] Port %SERVER_PORT% is already in use
    echo [INFO] Another NomadArch instance or app may be running
    echo [INFO] To find the process: netstat -ano | findstr ":%SERVER_PORT%"
    echo [INFO] To kill it: taskkill /F /PID <PID>
    set /a WARNINGS+=1
) else (
    echo [OK] Port %SERVER_PORT% is available
)

netstat -ano | findstr ":%UI_PORT%" | findstr "LISTENING" >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [WARN] Port %UI_PORT% is already in use
    echo [INFO] To find the process: netstat -ano | findstr ":%UI_PORT%"
    echo [INFO] To kill it: taskkill /F /PID <PID>
    set /a WARNINGS+=1
) else (
    echo [OK] Port %UI_PORT% is available
)

echo.
echo [STEP 5/5] Starting NomadArch...
echo.

if %ERRORS% gtr 0 (
    echo [ERROR] Cannot start due to errors!
    echo.
    pause
    exit /b 1
)

echo [INFO] Starting NomadArch...
echo [INFO] Server will run on http://localhost:%SERVER_PORT%
echo [INFO] Press Ctrl+C to stop
echo.

call npm run dev:electron

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] NomadArch exited with an error!
    echo.
    echo Common solutions:
    echo   1. Check that all dependencies are installed: npm install
    echo   2. Check that the UI is built: cd packages\ui ^&^& npm run build
    echo   3. Check for port conflicts (see warnings above)
    echo   4. Check the error message above for details
    echo.
    echo To reinstall everything: Install-Windows.bat
    echo.
)

pause
