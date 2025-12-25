@echo off
setlocal enabledelayedexpansion

title NomadArch Installer

echo.
echo NomadArch Installer (Windows)
echo Version: 0.4.0
echo.

set SCRIPT_DIR=%~dp0
set SCRIPT_DIR=%SCRIPT_DIR:~0,-1%
set TARGET_DIR=%SCRIPT_DIR%
set BIN_DIR=%TARGET_DIR%\bin
set LOG_FILE=%TARGET_DIR%\install.log
set TEMP_DIR=%TARGET_DIR%\.install-temp

set ERRORS=0
set WARNINGS=0
set NEEDS_FALLBACK=0

echo [%date% %time%] Installer started >> "%LOG_FILE%"

echo [STEP 1/9] OS and Architecture Detection
wmic os get osarchitecture | findstr /i "64-bit" >nul
if %ERRORLEVEL% equ 0 (
    set ARCH=x64
) else (
    set ARCH=x86
)
echo [OK] Architecture: %ARCH%

echo.
echo [STEP 2/9] Checking write permissions
if not exist "%BIN_DIR%" mkdir "%BIN_DIR%"
if not exist "%TEMP_DIR%" mkdir "%TEMP_DIR%"

echo. > "%SCRIPT_DIR%\test-write.tmp" 2>nul
if %ERRORLEVEL% neq 0 (
    echo [WARN] Cannot write to current directory: %SCRIPT_DIR%
    set TARGET_DIR=%USERPROFILE%\NomadArch-Install
    set BIN_DIR=%TARGET_DIR%\bin
    set LOG_FILE=%TARGET_DIR%\install.log
    set TEMP_DIR=%TARGET_DIR%\.install-temp
    if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"
    if not exist "%BIN_DIR%" mkdir "%BIN_DIR%"
    if not exist "%TEMP_DIR%" mkdir "%TEMP_DIR%"
    echo. > "%TARGET_DIR%\test-write.tmp" 2>nul
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Cannot write to fallback directory: %TARGET_DIR%
        echo [%date% %time%] ERROR: Write permission denied >> "%LOG_FILE%"
        set /a ERRORS+=1
        goto :SUMMARY
    )
    del "%TARGET_DIR%\test-write.tmp"
    set NEEDS_FALLBACK=1
    echo [OK] Using fallback: %TARGET_DIR%
) else (
    del "%SCRIPT_DIR%\test-write.tmp"
    echo [OK] Write permissions verified
)

echo.
echo [STEP 3/9] Ensuring system dependencies

set WINGET_AVAILABLE=0
where winget >nul 2>&1 && set WINGET_AVAILABLE=1

set CHOCO_AVAILABLE=0
where choco >nul 2>&1 && set CHOCO_AVAILABLE=1

set DOWNLOAD_CMD=
where curl >nul 2>&1
if %ERRORLEVEL% equ 0 (
    set DOWNLOAD_CMD=curl
) else (
    set DOWNLOAD_CMD=powershell
)

where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [INFO] Node.js not found. Attempting to install...
    if %WINGET_AVAILABLE% equ 1 (
        winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    ) else if %CHOCO_AVAILABLE% equ 1 (
        choco install nodejs-lts -y
    ) else (
        echo [ERROR] No supported package manager found (winget/choco).
        echo Please install Node.js LTS from https://nodejs.org/
        set /a ERRORS+=1
        goto :SUMMARY
    )
)

where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js install failed or requires a new terminal session.
    set /a ERRORS+=1
    goto :SUMMARY
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo [OK] Node.js: %NODE_VERSION%

where npm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm not found after Node.js install.
    set /a ERRORS+=1
    goto :SUMMARY
)

for /f "tokens=*" %%i in ('npm --version') do set NPM_VERSION=%%i
echo [OK] npm: %NPM_VERSION%

where git >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [INFO] Git not found. Attempting to install...
    if %WINGET_AVAILABLE% equ 1 (
        winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements
    ) else if %CHOCO_AVAILABLE% equ 1 (
        choco install git -y
    ) else (
        echo [WARN] Git not installed (optional). Continue.
        set /a WARNINGS+=1
    )
) else (
    for /f "tokens=*" %%i in ('git --version') do set GIT_VERSION=%%i
    echo [OK] Git: %GIT_VERSION%
)

echo.
echo [STEP 4/9] Installing npm dependencies
cd /d "%SCRIPT_DIR%"
echo [%date% %time%] Running npm install >> "%LOG_FILE%"
call npm install
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm install failed!
    echo [%date% %time%] ERROR: npm install failed >> "%LOG_FILE%"
    set /a ERRORS+=1
    goto :SUMMARY
)
echo [OK] Dependencies installed

echo.
echo [STEP 5/9] Fetching OpenCode binary
if not exist "%BIN_DIR%" mkdir "%BIN_DIR%"

for /f "delims=" %%v in ('powershell -NoProfile -Command "(Invoke-WebRequest -UseBasicParsing https://api.github.com/repos/sst/opencode/releases/latest).Content ^| Select-String -Pattern '""tag_name""' ^| ForEach-Object { $_.Line.Split(''\"'')[3] }"') do (
    set OPENCODE_VERSION=%%v
)

set OPENCODE_BASE=https://github.com/sst/opencode/releases/download/v!OPENCODE_VERSION!
set OPENCODE_URL=!OPENCODE_BASE!/opencode-windows-%ARCH%.exe
set CHECKSUM_URL=!OPENCODE_BASE!/checksums.txt

if exist "%BIN_DIR%\opencode.exe" (
    echo [OK] OpenCode binary already exists
    echo [%date% %time%] OpenCode binary exists, skipping download >> "%LOG_FILE%"
) else (
    echo [INFO] Downloading OpenCode v!OPENCODE_VERSION!...
    if "%DOWNLOAD_CMD%"=="curl" (
        curl -L -o "%BIN_DIR%\opencode.exe.tmp" "!OPENCODE_URL!"
        curl -L -o "%BIN_DIR%\checksums.txt" "!CHECKSUM_URL!"
    ) else (
        powershell -NoProfile -Command "Invoke-WebRequest -Uri '%OPENCODE_URL%' -OutFile '%BIN_DIR%\\opencode.exe.tmp'"
        powershell -NoProfile -Command "Invoke-WebRequest -Uri '%CHECKSUM_URL%' -OutFile '%BIN_DIR%\\checksums.txt'"
    )

    set EXPECTED_HASH=
    for /f "tokens=1,2" %%h in ('type "%BIN_DIR%\checksums.txt" ^| findstr /i "opencode-windows-%ARCH%"') do (
        set EXPECTED_HASH=%%h
    )

    set ACTUAL_HASH=
    for /f "skip=1 tokens=*" %%h in ('certutil -hashfile "%BIN_DIR%\opencode.exe.tmp" SHA256 ^| findstr /v "CertUtil" ^| findstr /v "hash of"') do (
        set ACTUAL_HASH=%%h
        goto :hash_found
    )
    :hash_found

    if "!ACTUAL_HASH!"=="!EXPECTED_HASH!" (
        move /Y "%BIN_DIR%\opencode.exe.tmp" "%BIN_DIR%\opencode.exe"
        echo [OK] OpenCode downloaded and verified
    ) else (
        echo [ERROR] OpenCode checksum mismatch!
        del "%BIN_DIR%\opencode.exe.tmp"
        set /a ERRORS+=1
    )
)

echo.
echo [STEP 6/9] Building UI assets
if exist "%SCRIPT_DIR%\packages\ui\dist\index.html" (
    echo [OK] UI build already exists
) else (
    echo [INFO] Building UI assets...
    pushd packages\ui
    call npm run build
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] UI build failed!
        popd
        set /a ERRORS+=1
        goto :SUMMARY
    )
    popd
    echo [OK] UI assets built successfully
)

echo.
echo [STEP 7/9] Post-install health check
set HEALTH_ERRORS=0

if not exist "%SCRIPT_DIR%\package.json" set /a HEALTH_ERRORS+=1
if not exist "%SCRIPT_DIR%\packages\ui" set /a HEALTH_ERRORS+=1
if not exist "%SCRIPT_DIR%\packages\server" set /a HEALTH_ERRORS+=1
if not exist "%SCRIPT_DIR%\packages\ui\dist\index.html" set /a HEALTH_ERRORS+=1

if %HEALTH_ERRORS% equ 0 (
    echo [OK] Health checks passed
) else (
    echo [ERROR] Health checks failed (%HEALTH_ERRORS%)
    set /a ERRORS+=%HEALTH_ERRORS%
)

echo.
echo [STEP 8/9] Installation Summary
echo.
echo   Install Dir: %TARGET_DIR%
echo   Architecture: %ARCH%
echo   Node.js: %NODE_VERSION%
echo   npm: %NPM_VERSION%
echo   Errors: %ERRORS%
echo   Warnings: %WARNINGS%
echo   Log File: %LOG_FILE%
echo.

echo [STEP 9/9] Next steps

:SUMMARY
if %ERRORS% gtr 0 (
    echo [RESULT] Installation completed with errors.
    echo Review the log: %LOG_FILE%
    echo.
    echo If Node.js was just installed, open a new terminal and run this installer again.
) else (
    echo [RESULT] Installation completed successfully.
    echo Run Launch-Windows.bat to start the application.
)

echo.
echo Press any key to exit...
pause >nul
exit /b %ERRORS%
