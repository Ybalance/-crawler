@echo off
chcp 65001 >nul
echo ========================================
echo   Smart Web Crawler System
echo   Zhi Neng Wang Luo Pa Chong Xi Tong
echo ========================================
echo.

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found, please install Python 3.8+
    pause
    exit /b 1
)

echo [1/4] Checking virtual environment...
if not exist "venv" (
    echo [INFO] Creating virtual environment...
    python -m venv venv
    if errorlevel 1 (
        echo [ERROR] Failed to create virtual environment
        pause
        exit /b 1
    )
)

echo [2/4] Activating virtual environment...
if exist "venv\Scripts\activate.bat" (
    call venv\Scripts\activate.bat
) else (
    echo [WARNING] Virtual environment activation skipped
    echo [INFO] Will use system Python
)

echo [3/4] Checking dependencies...
pip show Flask >nul 2>&1
if errorlevel 1 (
    echo [INFO] Installing dependencies...
    pip install -r requirements.txt
    if errorlevel 1 (
        echo [ERROR] Failed to install dependencies
        pause
        exit /b 1
    )
)

echo [4/4] Starting server...
echo.
echo ========================================
echo   Server started successfully!
echo   Access URL: http://localhost:8000
echo   Press Ctrl+C to stop
echo ========================================
echo.

python app.py

pause
