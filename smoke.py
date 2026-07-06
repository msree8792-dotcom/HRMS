# -*- coding: utf-8 -*-
"""End-to-end smoke test of the new endpoints against SQLite (no MySQL).
Mocks SMTP so no real email is sent. Run: python smoke.py"""
import os, re, sys, json

os.environ['DJANGO_SETTINGS_MODULE'] = 'hrms_project.test_settings'
import django
django.setup()

from django.conf import settings as dj_settings
from django.test import Client
from django.db import connection
from api import mailer

# fresh DB
db = dj_settings.DATABASES['default']['NAME']
try:
    if os.path.exists(db): os.remove(db)
except OSError:
    pass

# The legacy migrations contain MySQL-only raw SQL, so for this SQLite smoke
# test we create the tables we exercise straight from the model definitions.
from api import models as M
with connection.schema_editor() as se:
    for mdl in (M.Company, M.Role, M.PermissionGroup, M.Permission, M.RolePermission,
                M.AppUser, M.LoginOtp, M.PasswordReset, M.LiveSession,
                M.InterviewLink, M.JobPost, M.UserEmailConfig):
        se.create_model(mdl)

# Capture outbound email instead of sending it.
sent = []
mailer.send_email = lambda **kw: (sent.append(kw) or {'ok': True})

from api.models import AppUser
AppUser.objects.create(full_name='Mourya', email='mourya@eversoftit.com',
                       password='secret123', initials='MO', role='admin', status='active')

c = Client()
fails = []
def check(name, cond, extra=''):
    print(('PASS' if cond else 'FAIL'), name, '' if cond else ('-> ' + str(extra)))
    if not cond: fails.append(name)

def jp(resp):
    try: return json.loads(resp.content)
    except Exception: return {}

# 1) OTP login
r = c.post('/api/auth/login', data=json.dumps({'email': 'mourya@eversoftit.com', 'password': 'secret123'}),
           content_type='application/json')
d = jp(r)
check('login -> otpRequired', r.status_code == 200 and d.get('otpRequired') and d.get('emailSent'), (r.status_code, d))
check('login sent an email', len(sent) == 1, sent)
code = None
if sent:
    m = re.search(r'(\d{6})', sent[-1].get('text', '') or '')
    code = m.group(1) if m else None
check('otp code present in email', bool(code), sent[-1] if sent else None)

# wrong password
r = c.post('/api/auth/login', data=json.dumps({'email': 'mourya@eversoftit.com', 'password': 'nope'}),
           content_type='application/json')
check('login wrong password -> 401', r.status_code == 401, r.status_code)

# verify wrong code
r = c.post('/api/auth/verify-otp', data=json.dumps({'email': 'mourya@eversoftit.com', 'code': '000000'}),
           content_type='application/json')
check('verify wrong code -> 400', r.status_code == 400, r.status_code)

# verify correct code
r = c.post('/api/auth/verify-otp', data=json.dumps({'email': 'mourya@eversoftit.com', 'code': code}),
           content_type='application/json')
d = jp(r)
check('verify correct code -> user', r.status_code == 200 and d.get('ok') and d.get('user', {}).get('email') == 'mourya@eversoftit.com', (r.status_code, d))

# reused code rejected
r = c.post('/api/auth/verify-otp', data=json.dumps({'email': 'mourya@eversoftit.com', 'code': code}),
           content_type='application/json')
check('reused code rejected', r.status_code == 400, r.status_code)

# 2) Forgot + reset password
sent.clear()
r = c.post('/api/auth/forgot-password', data=json.dumps({'email': 'mourya@eversoftit.com', 'origin': 'http://localhost:8000'}),
           content_type='application/json')
check('forgot-password -> 200', r.status_code == 200, r.status_code)
token = None
if sent:
    m = re.search(r'token=([A-Za-z0-9_\-]+)', sent[-1].get('text', '') or '')
    token = m.group(1) if m else None
check('reset link/token emailed', bool(token), sent[-1] if sent else None)

r = c.post('/api/auth/verify-reset-token', data=json.dumps({'token': token}), content_type='application/json')
check('verify-reset-token valid', jp(r).get('valid') is True, jp(r))

r = c.post('/api/auth/reset-password', data=json.dumps({'token': token, 'password': 'brandnew1'}),
           content_type='application/json')
check('reset-password -> ok', r.status_code == 200 and jp(r).get('ok'), (r.status_code, jp(r)))
check('password updated in DB', AppUser.objects.get(email='mourya@eversoftit.com').password == 'brandnew1')

r = c.post('/api/auth/reset-password', data=json.dumps({'token': token, 'password': 'again123'}),
           content_type='application/json')
check('reset token single-use', r.status_code == 400, r.status_code)

# login with new password
r = c.post('/api/auth/login', data=json.dumps({'email': 'mourya@eversoftit.com', 'password': 'brandnew1'}),
           content_type='application/json')
check('login with new password works', r.status_code == 200, r.status_code)

# 3) Follow-up send (server-side)
from api.models import InterviewLink
iv = InterviewLink.objects.create(name='Ravi Kumar', initials='RK', role='Sr. Frontend Engineer',
                                  email='ravi.kumar@email.com', interview_date='Apr 12, 2025', interview_time='10:00 AM')
sent.clear()
r = c.post('/api/interviews/send-followup', data=json.dumps({'interviewId': iv.id, 'outcome': 'Selected'}),
           content_type='application/json')
d = jp(r)
check('follow-up send -> ok', r.status_code == 200 and d.get('ok'), (r.status_code, d))
check('follow-up emailed candidate', len(sent) == 1 and sent[-1]['to'] == 'ravi.kumar@email.com', sent)
iv.refresh_from_db()
check('follow-up marked email_sent + outcome', iv.email_sent and iv.outcome == 'Selected', (iv.email_sent, iv.outcome))

# 4) WebRTC live signaling round-trip
r = c.post('/api/live/start', data=json.dumps({'sessionId': 'sess1', 'candidateName': 'Ravi', 'role': 'FE', 'offer': '{"type":"offer","sdp":"x"}'}),
           content_type='application/json')
check('live start -> 201', r.status_code == 201, r.status_code)
r = c.get('/api/live')
check('live list shows session', any(s['sessionId'] == 'sess1' for s in jp(r)), jp(r))
r = c.post('/api/live/sess1/answer', data=json.dumps({'answer': '{"type":"answer","sdp":"y"}'}), content_type='application/json')
check('live answer -> ok', jp(r).get('ok') is True, jp(r))
r = c.post('/api/live/sess1/ice', data=json.dumps({'role': 'candidate', 'candidate': {'candidate': 'c1'}}), content_type='application/json')
check('live ice append -> ok', jp(r).get('ok') is True, jp(r))
r = c.get('/api/live/sess1')
d = jp(r)
check('live detail has offer+answer+ice', bool(d.get('offer')) and bool(d.get('answer')) and len(d.get('candidateIce', [])) == 1, d)
r = c.post('/api/live/sess1/end', data='{}', content_type='application/json')
check('live end -> ok', jp(r).get('ok') is True, jp(r))

# 5) Job creation still works (auto-post returns [], no creds configured)
r = c.post('/api/jobs', data=json.dumps({'title': 'QA Engineer', 'dept': 'Engineering'}), content_type='application/json')
d = jp(r)
check('job create -> 201', r.status_code == 201 and d.get('title') == 'QA Engineer', (r.status_code, d))
check('job socialResults present (empty)', d.get('socialResults') == [], d.get('socialResults'))

print('\n' + ('ALL PASSED' if not fails else 'FAILURES: ' + ', '.join(fails)))
try:
    os.remove(db)
except OSError:
    pass
sys.exit(1 if fails else 0)
