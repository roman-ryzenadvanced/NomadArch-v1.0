@echo off
setlocal enabledelayedexpansion

title NomadArch Launcher
color 0A

echo.
echo NomadArch Launcher (Windows)
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
    echo [INFO] If Node.js was installed, open a new terminal and run Launch-Windows.bat again.
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
echo [PREFLIGHT 4/7] Finding Available Port...

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

echo [OK] Server port: !SERVER_PORT!

if !SERVER_PORT! neq %DEFAULT_SERVER_PORT% (
    echo [INFO] Port %DEFAULT_SERVER_PORT% was in use, using !SERVER_PORT! instead
    set /a WARNINGS+=1
)

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
        goto :final_launch_check
    )
    popd
    echo [OK] UI build completed (auto-fix)
    set /a AUTO_FIXED+=1
) else (
    echo [OK] UI build directory exists
)

if not exist "packages\electron-app\dist\main\main.js" (
    echo [WARN] Electron build incomplete
    echo [INFO] Running full build...
    call npm run build
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Full build failed!
        set /a ERRORS+=1
        goto :final_launch_check
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
echo.

if %ERRORS% gtr 0 (
    echo [RESULT] Cannot start due to errors!
    echo.
    echo Please fix the errors above and try again.
    pause
    exit /b 1
)

echo [INFO] Starting NomadArch...
echo [INFO] Server will run on http://localhost:!SERVER_PORT!
echo [INFO] UI will run on http://localhost:!UI_PORT!
echo [INFO] Press Ctrl+C to stop
echo.

set SERVER_URL=http://localhost:!SERVER_PORT!
set VITE_PORT=!UI_PORT!

echo.
echo ========================================
echo   Starting UI dev server on port !UI_PORT!...
echo ========================================

pushd packages\ui
start "NomadArch UI Server" cmd /c "set VITE_PORT=!UI_PORT! && npm run dev"
popd

echo [INFO] Waiting for UI dev server to start...
timeout /t 3 /nobreak >nul

echo.
echo ========================================
echo   Starting Electron app...
echo ========================================

set "VITE_DEV_SERVER_URL=http://localhost:!UI_PORT!"
set "NOMADARCH_OPEN_DEVTOOLS=false"
call npm run dev:electron

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] NomadArch exited with an error!
    echo.
    echo Error Code: %ERRORLEVEL%
    echo.
    echo Troubleshooting:
    echo   1. Ensure port !SERVER_PORT! is not in use
    echo   2. Run Install-Windows.bat again
    echo   3. Check log file: packages\electron-app\.log
    echo.
)

:final_launch_check
echo.
echo Press any key to exit...
pause >nul
exit /b %ERRORS%
