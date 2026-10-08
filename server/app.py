"""Local, synthetic-data Digital Medico prototype. No external services required."""
import argparse
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import time
from datetime import datetime, timezone, timedelta
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / '.private'
DATA.mkdir(mode=0o700, exist_ok=True)
DB = DATA / 'medico.db'
SESSIONS = {}
LOGIN_ATTEMPTS = {}
SERVE_STATIC = False
SECURE_COOKIES = False


try:
    IST = ZoneInfo('Asia/Kolkata')
except ZoneInfoNotFoundError:
    # Windows Python may lack the IANA database; India uses UTC+05:30 year-round.
    IST = timezone(timedelta(hours=5, minutes=30), 'IST')


def today():
    return datetime.now(IST).date().isoformat()


def db():
    connection = sqlite3.connect(DB)
    connection.row_factory = sqlite3.Row
    return connection


def hashed(password, salt):
    return hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1).hex()


def init():
    with db() as c:
        c.executescript('''
            CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,role TEXT,name TEXT,email TEXT UNIQUE,salt TEXT,password TEXT);
            CREATE TABLE IF NOT EXISTS profiles(patient TEXT PRIMARY KEY,doctor TEXT,emergency_id TEXT UNIQUE,age INTEGER,blood TEXT,allergies TEXT,conditions TEXT);
            CREATE TABLE IF NOT EXISTS records(id INTEGER PRIMARY KEY,patient TEXT,date TEXT,doctor TEXT,title TEXT,detail TEXT);
            CREATE TABLE IF NOT EXISTS medicines(id INTEGER PRIMARY KEY,patient TEXT,name TEXT,dose TEXT,timing TEXT,status TEXT DEFAULT 'pending',day TEXT);
            CREATE TABLE IF NOT EXISTS dose_logs(id INTEGER PRIMARY KEY,patient TEXT,medicine INTEGER,name TEXT,status TEXT,day TEXT,time TEXT DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS consent(patient TEXT PRIMARY KEY,enabled INTEGER);
            CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,patient TEXT,actor TEXT,action TEXT,time TEXT DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY,patient TEXT,question TEXT,answer TEXT,status TEXT);
        ''')
        if not c.execute('SELECT 1 FROM users').fetchone():
            for uid, role, name, email in [('p1', 'patient', 'Alex Morgan', 'alex@demo.medico'), ('d1', 'doctor', 'Dr. Sarah Chen', 'sarah@demo.medico')]:
                salt = secrets.token_hex(16)
                c.execute('INSERT INTO users VALUES(?,?,?,?,?,?)', (uid, role, name, email, salt, hashed('MedicoDemo24!', salt)))
            c.execute('INSERT INTO consent VALUES(?,?)', ('p1', 1))
            c.executemany('INSERT INTO records(patient,date,doctor,title,detail) VALUES(?,?,?,?,?)', [
                ('p1', '2026-09-24', 'Dr. Sarah Chen', 'Routine follow-up', 'Blood pressure stable. Continue prescribed medication. Follow up in 4 weeks.'),
                ('p1', '2026-08-12', 'Dr. James Wilson', 'Annual health assessment', 'Hypertension reviewed. Penicillin allergy confirmed. No surgical history reported.'),
            ])
            c.executemany('INSERT INTO medicines(patient,name,dose,timing,day) VALUES(?,?,?,?,?)', [
                ('p1', 'Amlodipine', '5 mg · 1 tablet', '08:00', ''),
                ('p1', 'Vitamin D3', '1000 IU · 1 capsule', '13:00', ''),
                ('p1', 'Metformin', '500 mg · 1 tablet', '20:00', ''),
            ])
        # Add the profile on existing prototype databases without replacing user data.
        if c.execute('SELECT 1 FROM users WHERE id="p1"').fetchone():
            c.execute('INSERT OR IGNORE INTO profiles VALUES(?,?,?,?,?,?,?)', ('p1', 'd1', 'DM-00241', 28, 'O+', '["Penicillin"]', '["Hypertension","Type 2 diabetes"]'))
    os.chmod(DB, 0o600)


def audit(c, actor, action, patient):
    c.execute('INSERT INTO audit(patient,actor,action) VALUES(?,?,?)', (patient, actor, action))


def text(body, key, limit=2000):
    value = body.get(key, '')
    if not isinstance(value, str):
        raise ValueError('Invalid text')
    return value.strip()[:limit]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        # Never log patient questions, identifiers, cookies or passwords.
        pass

    def reply(self, status, data, cookie=None):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Length', str(len(body)))
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(body)

    def cookie_token(self):
        cookie = SimpleCookie()
        cookie.load(self.headers.get('Cookie', ''))
        return cookie['medico_session'].value if cookie.get('medico_session') else ''

    def user(self):
        session = SESSIONS.get(self.cookie_token())
        return session if session and session['expires'] > time.time() else None

    def sign_in(self, c, user):
        # Rotate the session when signing in rather than retaining an older role.
        SESSIONS.pop(self.cookie_token(), None)
        token = secrets.token_urlsafe(32)
        session = {'id': user['id'], 'role': user['role'], 'name': user['name'], 'csrf': secrets.token_urlsafe(24), 'expires': time.time() + 3600}
        SESSIONS[token] = session
        audit(c, user['name'], 'Signed in to ' + user['role'] + ' portal', user['id'])
        cookie = f'medico_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600' + ('; Secure' if SECURE_COOKIES else '')
        return self.reply(200, {'user': session}, cookie)

    def serve_static(self, path):
        root = (ROOT / 'dist').resolve()
        target = (root / unquote(path).lstrip('/')).resolve()
        if not target.is_relative_to(root):
            return self.reply(404, {'error': 'Not found'})
        if not target.is_file():
            if '.' in Path(path).name:
                return self.reply(404, {'error': 'Not found'})
            target = root / 'index.html'
        if not target.is_file():
            return self.reply(503, {'error': 'Build the interface with npm run build first.'})
        body = target.read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', mimetypes.guess_type(target.name)[0] or 'application/octet-stream')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.handle_api('GET')

    def do_POST(self):
        self.handle_api('POST')

    def handle_api(self, method):
        try:
            parsed = urlsplit(self.path)
            path = parsed.path
            if not path.startswith('/api/'):
                if SERVE_STATIC and method == 'GET':
                    return self.serve_static(path)
                return self.reply(404, {'error': 'Not found'})
            body = {}
            if method == 'POST':
                size = int(self.headers.get('Content-Length', 0))
                if size < 0 or size > 16384:
                    return self.reply(413, {'error': 'Request too large'})
                body = json.loads(self.rfile.read(size) or '{}')
                if not isinstance(body, dict):
                    return self.reply(400, {'error': 'Invalid request.'})
            with db() as c:
                if path in ('/api/login', '/api/register') and method == 'POST':
                    key = self.client_address[0]
                    recent = [t for t in LOGIN_ATTEMPTS.get(key, []) if time.time() - t < 60]
                    if len(recent) >= 10:
                        return self.reply(429, {'error': 'Too many sign-in attempts. Try again in a minute.'})
                    LOGIN_ATTEMPTS[key] = recent + [time.time()]
                    email = text(body, 'email', 254).lower()
                    password = body.get('password', '')
                    role = body.get('role')
                    if not isinstance(password, str) or len(password) > 120 or role not in ('patient', 'doctor'):
                        return self.reply(400, {'error': 'Choose a portal and enter your email and password.'})
                    if path == '/api/register':
                        if role != 'patient':
                            return self.reply(403, {'error': 'Doctor registration requires verified onboarding. Use the demo doctor account.'})
                        name = text(body, 'name', 100)
                        if not name or len(password) < 8 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
                            return self.reply(400, {'error': 'Enter a name, valid email and a password with at least 8 characters.'})
                        if c.execute('SELECT 1 FROM users WHERE email=?', (email,)).fetchone():
                            return self.reply(409, {'error': 'Unable to create this account. Try signing in or use another demo email.'})
                        uid = 'p_' + secrets.token_hex(8)
                        salt = secrets.token_hex(16)
                        c.execute('INSERT INTO users VALUES(?,?,?,?,?,?)', (uid, 'patient', name, email, salt, hashed(password, salt)))
                        c.execute('INSERT INTO profiles VALUES(?,?,?,?,?,?,?)', (uid, 'd1', 'DM-' + secrets.token_hex(4).upper(), None, 'Not recorded', '[]', '[]'))
                        c.execute('INSERT INTO consent VALUES(?,?)', (uid, int(body.get('consent') is True)))
                        audit(c, name, 'Created demo account; doctor access ' + ('granted' if body.get('consent') is True else 'disabled'), uid)
                        user = c.execute('SELECT * FROM users WHERE id=?', (uid,)).fetchone()
                        LOGIN_ATTEMPTS.pop(key, None)
                        return self.sign_in(c, user)
                    user = c.execute('SELECT * FROM users WHERE email=?', (email,)).fetchone()
                    if not user or not hmac.compare_digest(user['password'], hashed(password, user['salt'])):
                        return self.reply(401, {'error': 'Email or password is incorrect.'})
                    if user['role'] != role:
                        return self.reply(403, {'error': 'This account belongs to the ' + user['role'] + ' portal. Please select that workspace.'})
                    LOGIN_ATTEMPTS.pop(key, None)
                    return self.sign_in(c, user)

                user = self.user()
                if not user:
                    return self.reply(401, {'error': 'Please sign in.'})
                if method == 'POST' and not hmac.compare_digest(self.headers.get('X-CSRF-Token', ''), user['csrf']):
                    return self.reply(403, {'error': 'Invalid session request.'})
                if path == '/api/logout' and method == 'POST':
                    SESSIONS.pop(self.cookie_token(), None)
                    return self.reply(200, {}, 'medico_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' + ('; Secure' if SECURE_COOKIES else ''))
                if path == '/api/me' and method == 'GET':
                    return self.reply(200, {'user': user})
                if path == '/api/patients' and method == 'GET':
                    if user['role'] != 'doctor':
                        return self.reply(403, {'error': 'Doctor access required.'})
                    rows = c.execute('SELECT p.patient,c.enabled,u.name FROM profiles p JOIN users u ON u.id=p.patient JOIN consent c ON c.patient=p.patient WHERE p.doctor=? ORDER BY u.name', (user['id'],))
                    return self.reply(200, {'patients': [{'id': r['patient'], 'name': r['name'] if r['enabled'] else 'Access revoked', 'consent': bool(r['enabled'])} for r in rows]})

                requested = parse_qs(parsed.query).get('patient', [None])[0]
                pid = requested or ('p1' if user['role'] == 'doctor' else user['id'])
                if user['role'] == 'patient' and pid != user['id']:
                    return self.reply(403, {'error': 'You can only access your own information.'})
                profile = c.execute('SELECT p.*,u.name FROM profiles p JOIN users u ON u.id=p.patient WHERE p.patient=?', (pid,)).fetchone()
                if not profile or (user['role'] == 'doctor' and profile['doctor'] != user['id']):
                    return self.reply(403, {'error': 'This patient is not assigned to your account.'})
                enabled = bool(c.execute('SELECT enabled FROM consent WHERE patient=?', (pid,)).fetchone()[0])
                if path == '/api/consent' and method == 'POST':
                    if user['role'] != 'patient' or not isinstance(body.get('enabled'), bool):
                        return self.reply(403, {'error': 'Only the patient can change consent.'})
                    c.execute('UPDATE consent SET enabled=? WHERE patient=?', (body['enabled'], pid))
                    if body['enabled']:
                        c.execute('UPDATE messages SET status="pending" WHERE patient=? AND status="private"', (pid,))
                    audit(c, user['name'], 'Doctor access ' + ('granted' if body['enabled'] else 'revoked'), pid)
                    return self.reply(200, {'ok': True})
                if user['role'] == 'doctor' and not enabled:
                    return self.reply(403, {'error': 'Patient has revoked access. Ask the patient to grant consent.'})
                if path == '/api/audit' and method == 'GET':
                    return self.reply(200, {'audit': [dict(r) for r in c.execute('SELECT actor,action,time FROM audit WHERE patient=? ORDER BY id DESC LIMIT 50', (pid,))]})
                if path == '/api/dashboard' and method == 'GET':
                    c.execute('UPDATE medicines SET status="pending",day=? WHERE patient=? AND day!=?', (today(), pid, today()))
                    audit(c, user['name'], 'Viewed medical record', pid)
                    return self.reply(200, {
                        'consent': enabled,
                        'records': [dict(r) for r in c.execute('SELECT * FROM records WHERE patient=? ORDER BY date DESC,id DESC', (pid,))],
                        'medicines': [dict(r) for r in c.execute('SELECT * FROM medicines WHERE patient=? ORDER BY timing,id', (pid,))],
                        'messages': [dict(r) for r in c.execute('SELECT * FROM messages WHERE patient=? ORDER BY id DESC', (pid,))],
                        'doseLogs': [dict(r) for r in c.execute('SELECT name,status,day,time FROM dose_logs WHERE patient=? ORDER BY id DESC LIMIT 30', (pid,))],
                        'patient': {'name': profile['name'], 'uid': pid, 'id': profile['emergency_id'], 'age': profile['age'], 'blood': profile['blood'], 'allergies': json.loads(profile['allergies']), 'conditions': json.loads(profile['conditions'])},
                    })
                if path == '/api/profile' and method == 'POST':
                    if user['role'] != 'doctor':
                        return self.reply(403, {'error': 'Doctor access required.'})
                    age = int(body.get('age', 0))
                    blood = text(body, 'blood', 20)
                    if not 1 <= age <= 120 or blood not in ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Not recorded']:
                        return self.reply(400, {'error': 'Enter a valid age and blood group.'})
                    allergies = [a.strip() for a in text(body, 'allergies', 500).split(',') if a.strip()]
                    conditions = [a.strip() for a in text(body, 'conditions', 500).split(',') if a.strip()]
                    c.execute('UPDATE profiles SET age=?,blood=?,allergies=?,conditions=? WHERE patient=?', (age, blood, json.dumps(allergies), json.dumps(conditions), pid))
                    audit(c, user['name'], 'Updated emergency medical profile', pid)
                    return self.reply(200, {'ok': True})
                if path == '/api/medicine' and method == 'POST':
                    if user['role'] == 'doctor':
                        name, dose, timing = text(body, 'name', 100), text(body, 'dose', 200), text(body, 'timing', 10)
                        if not name or not dose:
                            return self.reply(400, {'error': 'Complete all prescription fields.'})
                        try:
                            timing = datetime.strptime(timing, '%H:%M').strftime('%H:%M')
                        except ValueError:
                            return self.reply(400, {'error': 'Use a valid medication time.'})
                        c.execute('INSERT INTO medicines(patient,name,dose,timing,day) VALUES(?,?,?,?,?)', (pid, name, dose, timing, today()))
                        audit(c, user['name'], 'Added a prescription: ' + name, pid)
                    else:
                        status = body.get('status')
                        if status not in ['taken', 'snoozed', 'missed']:
                            return self.reply(400, {'error': 'Invalid dose status.'})
                        med = c.execute('SELECT name FROM medicines WHERE id=? AND patient=?', (body.get('id'), pid)).fetchone()
                        if not med:
                            return self.reply(404, {'error': 'Medication not found in your account.'})
                        c.execute('UPDATE medicines SET status=?,day=? WHERE id=? AND patient=?', (status, today(), body['id'], pid))
                        c.execute('INSERT INTO dose_logs(patient,medicine,name,status,day) VALUES(?,?,?,?,?)', (pid, body['id'], med['name'], status, today()))
                        audit(c, user['name'], 'Medication ' + status + ': ' + med['name'], pid)
                    return self.reply(200, {'ok': True})
                if path == '/api/record' and method == 'POST':
                    if user['role'] != 'doctor':
                        return self.reply(403, {'error': 'Doctor access required.'})
                    title, detail = text(body, 'title', 120), text(body, 'detail')
                    if not title or not detail:
                        return self.reply(400, {'error': 'Enter a diagnosis and clinical notes.'})
                    c.execute('INSERT INTO records(patient,date,doctor,title,detail) VALUES(?,?,?,?,?)', (pid, today(), user['name'], title, detail))
                    audit(c, user['name'], 'Added a clinical record', pid)
                    return self.reply(200, {'ok': True})
                if path == '/api/emergency' and method == 'POST':
                    if user['role'] != 'doctor':
                        return self.reply(403, {'error': 'Doctor access required.'})
                    reason = text(body, 'reason', 200)
                    if text(body, 'patientId', 50) != profile['emergency_id'] or not reason or body.get('verified') is not True:
                        return self.reply(400, {'error': 'Matching patient ID, access reason and demo identity verification are required.'})
                    audit(c, user['name'], 'Emergency record access: ' + reason, pid)
                    return self.reply(200, {'ok': True})
                if path == '/api/chat' and method == 'POST':
                    if user['role'] != 'patient':
                        return self.reply(403, {'error': 'Patient access required.'})
                    question = text(body, 'question')
                    if not question:
                        return self.reply(400, {'error': 'Enter a question.'})
                    urgent = any(w in question.lower() for w in ['chest', 'breath', 'suicid', 'unconscious', 'stroke', 'severe', 'bleeding'])
                    routine = question.lower() in ['what is my medication schedule?', 'show my medication schedule', 'what is my next dose?'] and not urgent
                    if urgent:
                        answer = 'This may need urgent medical attention. Call your local emergency number now if symptoms are severe or sudden. Do not wait for a chat reply. I have also sent this message to your doctor.'
                    elif routine:
                        meds = c.execute('SELECT name,dose,timing FROM medicines WHERE patient=? ORDER BY timing', (pid,)).fetchall()
                        schedule = '; '.join(f'{m["name"]}: {m["dose"]} at {m["timing"]} IST' for m in meds)
                        answer = ('Your prescribed schedule: ' + schedule + '. ' if meds else 'No prescriptions are recorded yet. ') + 'Follow your doctor’s instructions. Do not change or double doses without clinical advice.'
                    else:
                        answer = 'I have sent your question to Dr. Sarah Chen for review. This demo assistant cannot diagnose symptoms or recommend treatment. Continue to follow your prescribed care plan; seek urgent care for severe or worsening symptoms.'
                    status = 'answered' if routine else 'pending' if enabled else 'private'
                    if not enabled and not routine:
                        answer = ('Call your local emergency number now for severe or sudden symptoms. Do not wait for a chat reply. ' if urgent else '') + 'Your doctor currently has no access to this account. This question is saved privately. Grant consent in Privacy & access to share your saved questions with your doctor.'
                    c.execute('INSERT INTO messages(patient,question,answer,status) VALUES(?,?,?,?)', (pid, question, answer, status))
                    audit(c, user['name'], 'Sent a Doctoc message', pid)
                    return self.reply(200, {'answer': answer, 'status': status})
                if path == '/api/reply' and method == 'POST':
                    if user['role'] != 'doctor':
                        return self.reply(403, {'error': 'Doctor access required.'})
                    answer = text(body, 'answer')
                    if not answer:
                        return self.reply(400, {'error': 'Enter a reply.'})
                    updated = c.execute('UPDATE messages SET answer=?,status="reviewed" WHERE id=? AND patient=?', (answer, body.get('id'), pid))
                    if not updated.rowcount:
                        return self.reply(404, {'error': 'Message not found for this patient.'})
                    audit(c, user['name'], 'Replied to patient question', pid)
                    return self.reply(200, {'ok': True})
                return self.reply(404, {'error': 'Not found'})
        except (ValueError, TypeError, KeyError):
            self.reply(400, {'error': 'Invalid request.'})
        except Exception:
            self.reply(500, {'error': 'The request could not be completed.'})


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--production', action='store_true')
    parser.add_argument('--secure-cookies', action='store_true')
    parser.add_argument('--port', type=int)
    args = parser.parse_args()
    SERVE_STATIC = args.production
    SECURE_COOKIES = args.secure_cookies
    host = '0.0.0.0' if args.production else '127.0.0.1'
    port = args.port or (5173 if args.production else 8000)
    init()
    print(f'Digital Medico {"app" if args.production else "API"} ready on port {port}', flush=True)
    ThreadingHTTPServer((host, port), Handler).serve_forever()
