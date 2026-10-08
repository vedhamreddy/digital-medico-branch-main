# Open and run the website in VS Code

This is a responsive **website**, built with React and Vite, connected to a Python API and a local SQLite database. No mobile application wrapper is included. A native application can be built later using the API.

1. Extract this entire folder from the ZIP.
2. Install Node.js 22 or newer (https://nodejs.org/) and Python 3.12 or newer (https://www.python.org/downloads/). On Windows, select **Add Python to PATH**.
3. In VS Code, choose **File → Open Folder** and select `Digital-Medico-Website`. Or open `Digital-Medico.code-workspace`.
4. Open **Terminal → New Terminal**. On Windows, choose **Command Prompt** from the terminal dropdown.
5. Run:

```sh
npm ci
npm run dev
```

6. Keep the terminal running and open **http://localhost:5173** in your browser. This command starts both the website and API. Do not open `index.html` directly or use the Live Server extension; those do not run the authenticated backend.

You can also use **Terminal → Run Task** to choose Install website dependencies, Start website, Build website, or Test backend.

## Project folders

- `src/main.jsx`: patient and doctor interfaces, forms and client workflows.
- `src/style.css`: responsive website styling.
- `server/app.py`: login, sessions, patient isolation, consent, clinical records, medication schedules, Doctoc and database.
- `scripts/`: cross-platform development and Python launch helpers.
- `tests/test_api.py`: 13 functional API tests.
- `.vscode/tasks.json`: VS Code tasks.
- `dist/`: the included prebuilt website; regenerate it after changing source.
- `docs/DEMO.md`: hackathon presentation walkthrough.
- `.private/`: created locally on first run; database excluded from Git and this download.

## Sign in

Patient: **alex@demo.medico**  
Doctor: **sarah@demo.medico**  
Password for both: **MedicoDemo24!**

The correct credentials are prefilled when you select each portal. New fictional patient accounts can also be created.

## Build and run without the development server

Stop the running development server with Ctrl+C, then:

```sh
npm test
npm run build
npm start
```

Open http://localhost:5173. The built website and API are served together. Putting only `dist/` on a static hosting provider will not provide login or medical workflows; this website needs its Python backend too.

## Important prototype boundaries

Use fictional data only. Biometric verification is simulated; Doctoc uses scripted guidance. Local storage is not encrypted at rest. Medication reminders require the website to remain open. See README.md for implementation and privacy details.
