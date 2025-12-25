@echo off
setlocal enabledelayedexpansion

title NomadArch Launcher (Production Mode)
color 0A

echo.
echo NomadArch Launcher (Windows, Production Mode)
echo Version: 0.4.0
echo Features: SMART FIX / APEX / SHIELD / MULTIX MODE
echo.

set SCRIPT_DIR=%~dp0
set SCRIPT_DIR=%SCRIPT_DIR:~0,-1%
cd /d "%SCRIPT_DIR%"

echo [STEP 1/3] Checking Dependencies...

where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [WARN] Node.js not found. Running installer...
    call "%SCRIPT_DIR%\Install-Windows.bat"
    echo [INFO] If Node.js was installed, open a new terminal and run Launch-Windows-Prod.bat again.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo [OK] Node.js: %NODE_VERSION%

echo.
echo [STEP 2/3] Checking Pre-Built UI...

if exist "packages\electron-app\dist\renderer\assets" (
    echo [OK] Pre-built UI assets found
) else (
    echo [ERROR] Pre-built UI assets not found.
    echo Run: npm run build
    pause
    exit /b 1
)

echo.
echo [STEP 3/3] Starting NomadArch (Production Mode)...

pushd packages\electron-app
npx electron .
popd

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] NomadArch exited with an error!
    echo.
)

pause
exit /b %ERRORLEVEL%
