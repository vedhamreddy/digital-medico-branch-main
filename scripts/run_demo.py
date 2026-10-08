"""Run the prebuilt demo with Python only and open the local browser."""
import os
from pathlib import Path
import runpy
import sys
import threading
import webbrowser

if sys.version_info < (3, 12):
    print('Please install Python 3.12 or newer from https://www.python.org/downloads/')
    raise SystemExit(1)
root = Path(__file__).resolve().parents[1]
os.chdir(root)
if not (root / 'dist/index.html').exists():
    print('The prebuilt interface is missing. Run npm ci and npm run build first.')
    raise SystemExit(1)
print('Starting Digital Medico. Keep this window open. Ctrl+C stops the app.', flush=True)
sys.argv = [str(root / 'server/app.py'), '--production']
threading.Timer(1.5, lambda: webbrowser.open('http://localhost:5173')).start()
try:
    runpy.run_path(str(root / 'server/app.py'), run_name='__main__')
except KeyboardInterrupt:
    print('\nDigital Medico stopped.')
