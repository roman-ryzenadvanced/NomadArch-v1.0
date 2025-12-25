@echo off
setlocal enabledelayedexpansion

title NomadArch Development Launcher
color 0B

echo.
echo NomadArch Development Launcher (Windows)
echo Version: 0.4.0
echo.

set SCRIPT_DIR=%~dp0
set SCRIPT_DIR=%SCRIPT_DIR:~0,-1%
cd /d "%SCRIPT_DIR%"

set ERRORS=0
set WARNINGS=0
set AUTO_FIXED=0

echo [PREFLIGHT 1/7] Checking Dependencies...

where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [WARN] Node.js not found. Running installer...
    call "%SCRIPT_DIR%\Install-Windows.bat"
    echo [INFO] If Node.js was installed, open a new terminal and run Launch-Dev-Windows.bat again.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo [OK] Node.js: %NODE_VERSION%

where npm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm not found!
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('npm --version') do set NPM_VERSION=%%i
echo [OK] npm: %NPM_VERSION%

echo.
echo [PREFLIGHT 2/7] Checking for OpenCode CLI...

where opencode >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [OK] OpenCode CLI available in PATH
) else (
    if exist "bin\opencode.exe" (
        echo [OK] OpenCode binary found in bin/
    ) else (
        echo [WARN] OpenCode CLI not found
        echo [INFO] Run Install-Windows.bat to set up OpenCode
        set /a WARNINGS+=1
    )
)

echo.
echo [PREFLIGHT 3/7] Checking Dependencies...

if not exist "node_modules" (
    echo [INFO] Dependencies not installed. Installing now...
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Dependency installation failed!
        pause
        exit /b 1
    )
    echo [OK] Dependencies installed (auto-fix)
    set /a AUTO_FIXED+=1
) else (
    echo [OK] Dependencies found
)

echo.
echo [PREFLIGHT 4/7] Finding Available Ports...

set DEFAULT_SERVER_PORT=3001
set DEFAULT_UI_PORT=3000
set SERVER_PORT=%DEFAULT_SERVER_PORT%
set UI_PORT=%DEFAULT_UI_PORT%

for /l %%p in (%DEFAULT_SERVER_PORT%,1,3050) do (
    netstat -ano | findstr ":%%p " | findstr "LISTENING" >nul
    if !ERRORLEVEL! neq 0 (
        set SERVER_PORT=%%p
        goto :server_port_found
    )
)
:server_port_found

for /l %%p in (%DEFAULT_UI_PORT%,1,3050) do (
    netstat -ano | findstr ":%%p " | findstr "LISTENING" >nul
    if !ERRORLEVEL! neq 0 (
        set UI_PORT=%%p
        goto :ui_port_found
    )
)
:ui_port_found

echo [OK] Server port: !SERVER_PORT!
echo [OK] UI port: !UI_PORT!

echo.
echo [PREFLIGHT 5/7] Final Checks...

if not exist "packages\ui\dist\index.html" (
    echo [WARN] UI build directory not found
    echo [INFO] Running UI build...
    pushd packages\ui
    call npm run build
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] UI build failed!
        popd
        set /a ERRORS+=1
        goto :launch_check
    )
    popd
    echo [OK] UI build completed (auto-fix)
    set /a AUTO_FIXED+=1
)

if not exist "packages\electron-app\dist\main\main.js" (
    echo [WARN] Electron build incomplete
    echo [INFO] Running full build...
    call npm run build
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Full build failed!
        set /a ERRORS+=1
        goto :launch_check
    )
    echo [OK] Full build completed (auto-fix)
    set /a AUTO_FIXED+=1
)

echo.
echo [PREFLIGHT 6/7] Launch Summary

echo [STATUS]
echo.
echo   Node.js: %NODE_VERSION%
echo   npm: %NPM_VERSION%
echo   Auto-fixes applied: !AUTO_FIXED!
echo   Warnings: %WARNINGS%
echo   Errors: %ERRORS%
echo   Server Port: !SERVER_PORT!
echo   UI Port: !UI_PORT!
echo.

if %ERRORS% gtr 0 (
    echo [RESULT] Cannot start due to errors!
    pause
    exit /b 1
)

echo.
echo [PREFLIGHT 7/7] Starting NomadArch in Development Mode...
echo [INFO] Server: http://localhost:!SERVER_PORT!
echo [INFO] UI: http://localhost:!UI_PORT!
echo.

start "NomadArch Server" cmd /k "cd /d \"%~dp0packages\server\" && set CLI_PORT=!SERVER_PORT! && npm run dev"
timeout /t 3 /nobreak >nul
start "NomadArch UI" cmd /k "cd /d \"%~dp0packages\ui\" && set VITE_PORT=!UI_PORT! && npm run dev -- --port !UI_PORT!"
timeout /t 3 /nobreak >nul
start "NomadArch Electron" cmd /k "cd /d \"%~dp0packages\electron-app\" && npm run dev"

echo.
echo [OK] All services started.
echo Press any key to stop all services...
pause >nul

taskkill /F /FI "WINDOWTITLE eq NomadArch*" >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq NomadArch Server*" >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq NomadArch UI*" >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq NomadArch Electron*" >nul 2>&1

:launch_check
pause
exit /b %ERRORS%
