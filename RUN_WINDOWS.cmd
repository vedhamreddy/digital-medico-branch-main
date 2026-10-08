@echo off
cd /d "%~dp0"
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3,12) else 1)" >nul 2>&1
if not errorlevel 1 (
    py -3 scripts\run_demo.py
    goto finished
)
python -c "import sys; sys.exit(0 if sys.version_info >= (3,12) else 1)" >nul 2>&1
if not errorlevel 1 (
    python scripts\run_demo.py
    goto finished
)
echo Install Python 3.12 or newer from https://www.python.org/downloads/
echo Select "Add Python to PATH" during installation, then run this file again.
:finished
pause
