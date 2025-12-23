@echo off
title NomadArch Development Launcher
color 0B
setlocal enabledelayedexpansion

echo.
echo  ███╗   ██╗ ██████╗ ███╗   ███╗ █████╗ ██████╗  █████╗ ██████╗  ██████╗██╗  ██╗
echo  ████╗  ██║██╔═══██╗████╗ ████║██╔══██╗██╔══██╗██╔══██╗██╔════╝██║  ██║
echo  ██╔██╗ ██║██║   ██║██╔████╔██║███████║██║  ██║███████║██████╔╝██║     ███████║
echo  ██║╚██╗██║██║   ██║██║╚██╔╝██║██╔══██║██║  ██║██╔══██║██╔══██╗██║     ██╔══██║
echo  ██║ ╚████║╚██████╔╝██║ ╚═╝ ██║██║  ██║██████╔╝██║  ██║██║  ██║╚██████╗██║  ██║
echo  ╚═╝  ╚═══╝ ╚═════╝ ╚═╝     ╚═╝╚═╝  ╚═╝╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝
echo.
echo  DEVELOPMENT MODE - Separate Server & UI Terminals
echo  ═════════════════════════════════════════════════════════════════════════════
echo.

cd /d "%~dp0"

echo [STEP 1/4] Checking Dependencies...
echo.

where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js not found!
    echo.
    echo Please install Node.js first: https://nodejs.org/
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
echo [STEP 2/4] Checking for OpenCode CLI...
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
    )
)

echo.
echo [STEP 3/4] Checking Port Availability...
echo.

set SERVER_PORT=3001
set UI_PORT=3000

netstat -ano | findstr ":%SERVER_PORT%" | findstr "LISTENING" >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [WARN] Port %SERVER_PORT% is already in use
    echo [INFO] Another NomadArch instance may be running
    echo [INFO] To find process: netstat -ano | findstr ":%SERVER_PORT%"
    echo [INFO] To kill it: taskkill /F /PID ^<PID^>
) else (
    echo [OK] Port %SERVER_PORT% is available
)

netstat -ano | findstr ":%UI_PORT%" | findstr "LISTENING" >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [WARN] Port %UI_PORT% is already in use
    echo [INFO] To find process: netstat -ano | findstr ":%UI_PORT%"
    echo [INFO] To kill it: taskkill /F /PID ^<PID^>
) else (
    echo [OK] Port %UI_PORT% is available
)

echo.
echo [STEP 4/4] Starting NomadArch in Development Mode...
echo.
echo [INFO] This will open 3 separate terminal windows:
echo   1. Backend Server (port 3001)
echo   2. Frontend UI (port 3000)
echo   3. Electron App
echo.
echo [INFO] Press any key to start...
pause >nul

echo.
echo [INFO] Starting Backend Server...
start "NomadArch Server" cmd /k "cd /d \"%~dp0packages\server\" && npm run dev"

echo [INFO] Starting Frontend UI...
start "NomadArch UI" cmd /k "cd /d \"%~dp0packages\ui\" && npm run dev"

echo [INFO] Starting Electron App...
start "NomadArch Electron" cmd /k "cd /d \"%~dp0packages\electron-app\" && npm run dev"

echo.
echo [OK] All services started!
echo.
echo Press any key to stop all services (Ctrl+C in each window also works)...
pause >nul

echo.
echo [INFO] Stopping all services...
taskkill /F /FI "WINDOWTITLE eq NomadArch*" >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq NomadArch Server*" >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq NomadArch UI*" >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq NomadArch Electron*" >nul 2>&1

echo [OK] All services stopped.
echo.
pause
