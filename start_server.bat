@echo off
echo ===================================================
echo Starting Medicare Portal Local Server...
echo ===================================================

cd /d "%~dp0"

echo Checking for Node.js...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Node.js is not installed or not in your PATH!
    echo Please go to https://nodejs.org and download the LTS version.
    echo Install it, and then try running this file again.
    echo.
    pause
    exit /b
)

IF NOT EXIST "node_modules" (
    echo Installing required packages (this may take a minute)...
    call npm install
)

echo.
echo Starting the server...
echo Once you see "Server running", open your web browser to http://localhost:3000
echo.
call node server.js

pause
