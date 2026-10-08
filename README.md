# Digital Medico

A working hackathon prototype based on `DIGITAL_MEDICO_Final.pptx`. Separate patient and doctor portals connect emergency medical history, Doctoc communication and medication reminders, with patient consent and an access audit trail.

## Start developing

Requires Node.js 22+ and Python 3.12+. No API keys, paid services or database server required.

```sh
npm ci
npm run dev
```

Open the Vite address printed in the terminal (default port 5173). This **single command starts both the interface and API**. Python listens on loopback port 8000, proxied through Vite. Both processes stop together with Ctrl+C. Use the existing checkout; a new Git worktree is unnecessary.

## Run the production build locally

Stop the development server first, then:

```sh
npm run build
npm start
```

The Python server serves the built interface and API together on port 5173, avoiding separate frontend/backend setup. For another port use `python server/app.py --production --port 5174`. Production mode here refers to the optimized frontend build; the healthcare security requirements below still apply. Behind a configured HTTPS reverse proxy, add `--secure-cookies` so cookies require HTTPS.

## Sign in

| Portal | Email | Password |
| --- | --- | --- |
| Patient | alex@demo.medico | MedicoDemo24! |
| Doctor | sarah@demo.medico | MedicoDemo24! |

Select **I'm a patient** or **I'm a doctor** and use the prefilled demo credentials. The backend checks the selected portal against the authenticated account. Emails ignore leading/trailing spaces and case. Invalid passwords do not create a session. Page refresh restores an active session; sign-out invalidates it. In-memory sessions expire after an hour and do not survive API restarts.

Patients can also choose **Create a demo patient account**, using fictional details and a password with at least eight characters. Every account has its own records, medications, messages, emergency ID and audit trail. Doctor access starts disabled unless the patient explicitly opts in. New demo patients are assigned to the fictional Dr. Sarah Chen. Public doctor registration is blocked; real clinician identity onboarding is outside this prototype.

## Demonstration flow

1. Enter the patient portal. Review history, allergies and medication schedule. Mark a dose taken, snooze it, or mark it missed.
2. Ask Doctoc for the medication schedule; it reads that patient's actual prescriptions. Ask a clinical question; it escalates to the doctor. Severe-symptom keywords trigger emergency-care guidance rather than a diagnosis.
3. Sign out and enter the doctor portal. Select a consented patient. Review adherence, update their emergency profile, add a clinical record or prescription, and reply to their question.
4. Use **Emergency access** with the matching emergency ID, an access reason and simulated identity verification. The event appears in the patient's audit trail. No biometric data is collected.
5. Return to the patient portal. The record, prescription and reply are visible. Revoke doctor access in **Privacy & access**. Medical reads, edits, questions and emergency access are then denied by the server. Patient access remains available.
6. Grant consent again to restore access. Questions saved while consent is disabled stay private and become shareable when the patient grants access. Clinical data survives server restarts. The doctor selector reflects consent changes; a revoked patient's name is hidden in the list.

See [the three-minute demo script](docs/DEMO.md).

## Medication reminders

Times use Asia/Kolkata (IST). The app checks due doses while open, displays an in-app reminder with a short sound after opting in, and optionally a browser notification if permission is granted. An unanswered reminder is marked missed after five minutes. Snooze displays another reminder after five minutes. Daily statuses reset on the next IST day when data is requested; dose activity remains in a separate history. Background refresh occurs every 15 seconds. Browser timers are not reliable with a closed or suspended tab. This is not a background medical alarm service.

## Validation

```sh
npm test
npm run build
```

Thirteen isolated-database API tests cover both portal identities, invalid authentication, normalized emails, portal mismatch, CSRF, roles, consent, prescriptions/adherence, profiles, records/emergency audit, questions/replies, registration, patient isolation and logout. They never modify the demo database.

Browser checks cover both portals in development and production modes, session restoration after refresh, logout, wrong-portal rejection, mobile layouts, patient registration, clinician patient selection, profile editing, record/prescription creation, doctor replies, timed medication reminders, automatic missed-dose logging and consent revocation.

## Privacy and prototype boundaries

- scrypt-hashed passwords with individual salts; HTTP-only, SameSite=Strict session cookies; one-hour sessions; session rotation on login.
- Server-side role, patient assignment, patient isolation and consent checks. CSRF tokens for authenticated writes, authentication rate limiting, parameterized SQL and disabled response caching.
- No external AI, analytics, web fonts or biometric processing. Doctoc is a conservative scripted assistant, not a language model or diagnostic tool. Production static responses use a restrictive content security policy.
- Local SQLite keeps setup achievable for a 24-hour hackathon instead of requiring the presentation's proposed MySQL server. `.private/medico.db` is ignored by Git, with restricted filesystem permissions. It is **not encrypted at rest**. Audit rows share the same database and are not tamper-proof.
- Only synthetic data may be used. This is not a production medical system or a claim of regulatory compliance. HTTPS, encrypted storage/backups, verified clinician identities, patient-assignment management, reliable background notifications and security/clinical review are required before real medical information.
- The fictional seeded pair starts with consent enabled. Newly registered accounts require explicit opt-in. Emergency access respects consent; there is no hidden bypass.

To reset only synthetic demo data, stop the app, delete `.private/medico.db`, and restart. Never reset a database with user information without explicit authorization.
