"""
Authentication endpoints: two-step (OTP) login, Google OAuth, and forgot/reset password.

Login flow
  POST /api/auth/login        {email, password}        -> sends OTP, returns {otpRequired:true}
  POST /api/auth/verify-otp   {email, code}            -> {ok:true, user:{...}}
  POST /api/auth/resend-otp   {email}                  -> re-sends a fresh code
  POST /api/auth/google       {idToken}                -> {ok:true, user:{...}} (no OTP)

Password reset flow
  POST /api/auth/forgot-password {email}               -> emails a reset link
  POST /api/auth/reset-password  {token, password}     -> updates the password
"""
import hashlib
import os
import secrets
from datetime import timedelta

import requests as http_requests
from django.conf import settings
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
import logging

from . import mailer
from .models import AppUser, LoginOtp, PasswordReset
from .views import app_user_dict, err, make_initials, norm_email, parse_body

OTP_TTL_MINUTES = 10
OTP_MAX_ATTEMPTS = 5
RESET_TTL_MINUTES = 60


def _hash_code(code, salt):
    return hashlib.sha256(f'{salt}:{code}'.encode('utf-8')).hexdigest()


def _dev_otp_enabled():
    """Whether to print the OTP to the server console when email can't be sent.

    Active in DEBUG, or when DEV_OTP_ECHO is truthy. This lets a developer
    finish signing in offline (e.g. when Resend/SMTP is unreachable) without
    ever exposing the code over the network — it goes only to the server log.
    """
    if str(os.environ.get('DEV_OTP_ECHO', '')).strip().lower() in ('1', 'true', 'yes', 'on'):
        return True
    return bool(getattr(settings, 'DEBUG', False))


def _issue_otp(user, sender_email=None):
    """Create + email a fresh 6-digit OTP for the user. Returns mailer result."""
    code = f'{secrets.randbelow(1_000_000):06d}'
    salt = secrets.token_hex(8)
    # Invalidate any earlier un-consumed codes for this email.
    LoginOtp.objects.filter(email=user.email, consumed=False).update(consumed=True)
    LoginOtp.objects.create(
        email=user.email,
        code_hash=_hash_code(code, salt),
        salt=salt,
        expires_at=timezone.now() + timedelta(minutes=OTP_TTL_MINUTES),
    )
    html = mailer.render_branded(
        title='Your login verification code',
        intro=f'Hi {user.full_name or "there"}, use the code below to finish signing in to your HRMS account. '
              f'It expires in {OTP_TTL_MINUTES} minutes.',
        highlight_html=(
            f'<div style="text-align:center;margin:8px 0 4px;">'
            f'<span style="display:inline-block;font-family:Consolas,monospace;font-size:34px;'
            f'font-weight:800;letter-spacing:10px;color:#4f8ef7;background:#eef4ff;'
            f'border-radius:12px;padding:16px 28px;">{code}</span></div>'
        ),
        footer="If you didn't try to sign in, you can safely ignore this email.",
    )
    text = f'Your HRMS login verification code is {code}. It expires in {OTP_TTL_MINUTES} minutes.'
    result = mailer.send_email(
        to=user.email,
        subject='Your HRMS login code',
        html=html,
        text=text,
        sender_email=sender_email,
    )
    if not result.get('ok') and _dev_otp_enabled():
        # Email could not be delivered (e.g. no network / Resend unreachable).
        # Print the code to the server console so login still works offline.
        logging.warning(
            '[DEV OTP] Email delivery failed (%s). Verification code for %s is %s '
            '(valid %d min) — enter it on the code screen.',
            result.get('error', ''), user.email, code, OTP_TTL_MINUTES,
        )
        result['devEcho'] = True
    return result


@csrf_exempt
def login(request):
    try:
        if request.method != 'POST':
            return err('Method not allowed', 405)
        body = parse_body(request)
        email = norm_email(body.get('email'))
        password = body.get('password') or ''
        if not email or not password:
            return err('email and password are required')

        user = AppUser.objects.filter(email=email).first()
        # Constant-ish messaging: don't reveal which half was wrong.
        if not user or user.password != password:
            return err('Invalid email or password', 401)
        if user.status != 'active':
            return err('This account is disabled. Contact your administrator.', 403)

        result = _issue_otp(user)
        if not result.get('ok'):
            if result.get('devEcho'):
                # Dev mode: code is in the server console — proceed to the code screen.
                return JsonResponse({
                    'otpRequired': True,
                    'emailSent': False,
                    'devMode': True,
                    'email': user.email,
                    'message': 'Email service is unreachable — your 6-digit code was printed to the '
                               'server console (dev mode). Enter it below to continue.',
                })
            return JsonResponse({
                'otpRequired': True,
                'emailSent': False,
                'message': 'Could not send the verification code: ' + result.get('error', 'unknown error'),
            }, status=502)

        masked = _mask_email(user.email)
        return JsonResponse({
            'otpRequired': True,
            'emailSent': True,
            'email': user.email,
            'message': f'A 6-digit verification code was sent to {masked}.',
        })
    except Exception:
        logging.exception('Unhandled exception in auth_views.login')
        return err('Server error', 500)


@csrf_exempt
def resend_otp(request):
    if request.method != 'POST':
        return err('Method not allowed', 405)
    body = parse_body(request)
    email = norm_email(body.get('email'))
    user = AppUser.objects.filter(email=email).first()
    if not user:
        return err('Invalid email or password', 401)
    result = _issue_otp(user)
    if not result.get('ok'):
        if result.get('devEcho'):
            return JsonResponse({'ok': True, 'devMode': True,
                                 'message': 'Email unreachable — a new code was printed to the server console (dev mode).'})
        return err('Could not send the verification code: ' + result.get('error', 'unknown error'), 502)
    return JsonResponse({'ok': True, 'message': f'A new code was sent to {_mask_email(user.email)}.'})


@csrf_exempt
def verify_otp(request):
    if request.method != 'POST':
        return err('Method not allowed', 405)
    body = parse_body(request)
    email = norm_email(body.get('email'))
    code = str(body.get('code') or '').strip()
    if not email or not code:
        return err('email and code are required')

    otp = (
        LoginOtp.objects
        .filter(email=email, consumed=False)
        .order_by('-id')
        .first()
    )
    if not otp:
        return err('No active code. Please request a new one.', 400)
    if otp.expires_at < timezone.now():
        otp.consumed = True
        otp.save(update_fields=['consumed'])
        return err('This code has expired. Please request a new one.', 400)
    if otp.attempts >= OTP_MAX_ATTEMPTS:
        otp.consumed = True
        otp.save(update_fields=['consumed'])
        return err('Too many incorrect attempts. Please request a new code.', 429)

    if _hash_code(code, otp.salt) != otp.code_hash:
        otp.attempts += 1
        otp.save(update_fields=['attempts'])
        remaining = max(0, OTP_MAX_ATTEMPTS - otp.attempts)
        return err(f'Incorrect code. {remaining} attempt(s) left.', 400)

    otp.consumed = True
    otp.save(update_fields=['consumed'])
    user = AppUser.objects.filter(email=email).first()
    if not user:
        return err('User not found', 404)
    return JsonResponse({'ok': True, 'user': app_user_dict(user)})


@csrf_exempt
def forgot_password(request):
    if request.method != 'POST':
        return err('Method not allowed', 405)
    body = parse_body(request)
    email = norm_email(body.get('email'))
    if not email:
        return err('email is required')

    user = AppUser.objects.filter(email=email).first()
    # Always answer the same way so attackers can't enumerate accounts.
    generic = JsonResponse({
        'ok': True,
        'message': "If an account exists for that email, a reset link is on its way.",
    })
    if not user:
        return generic

    token = secrets.token_urlsafe(32)
    PasswordReset.objects.create(
        email=user.email,
        token=token,
        expires_at=timezone.now() + timedelta(minutes=RESET_TTL_MINUTES),
    )
    origin = body.get('origin') or _request_origin(request)
    reset_url = f'{origin}/reset-password?token={token}'
    html = mailer.render_branded(
        title='Reset your HRMS password',
        intro=f'Hi {user.full_name or "there"}, we received a request to reset your password. '
              f'Click the button below to choose a new one. This link is valid for {RESET_TTL_MINUTES} minutes.',
        highlight_html=(
            f'<div style="text-align:center;margin:18px 0;">'
            f'<a href="{reset_url}" target="_blank" rel="noreferrer noopener" '
            f'style="display:inline-block;background:linear-gradient(135deg,#4f8ef7,#a855f7);'
            f'color:#fff;font-size:15px;font-weight:700;text-decoration:none;'
            f'padding:14px 38px;border-radius:10px;">Reset my password</a></div>'
            f'<div style="text-align:center;"><a href="{reset_url}" '
            f'style="color:#94a3b8;font-size:12px;word-break:break-all;">{reset_url}</a></div>'
        ),
        footer="If you didn't request this, you can safely ignore this email — your password won't change.",
    )
    text = f'Reset your HRMS password using this link (valid {RESET_TTL_MINUTES} min): {reset_url}'
    result = mailer.send_email(to=user.email, subject='Reset your HRMS password', html=html, text=text)
    if not result.get('ok'):
        return err('Could not send the reset email: ' + result.get('error', 'unknown error'), 502)
    return generic


@csrf_exempt
def reset_password(request):
    if request.method != 'POST':
        return err('Method not allowed', 405)
    body = parse_body(request)
    token = str(body.get('token') or '').strip()
    password = body.get('password') or ''
    if not token or not password:
        return err('token and password are required')
    if len(password) < 6:
        return err('Password must be at least 6 characters.')

    pr = PasswordReset.objects.filter(token=token).first()
    if not pr or pr.used_at is not None:
        return err('This reset link is invalid or has already been used.', 400)
    if pr.expires_at < timezone.now():
        return err('This reset link has expired. Please request a new one.', 400)

    user = AppUser.objects.filter(email=pr.email).first()
    if not user:
        return err('Account not found.', 404)

    user.password = password
    user.save(update_fields=['password'])
    pr.used_at = timezone.now()
    pr.save(update_fields=['used_at'])
    return JsonResponse({'ok': True, 'email': user.email, 'message': 'Your password has been updated.'})


@csrf_exempt
def verify_reset_token(request):
    """Lightweight check used by the reset page to validate the link on load."""
    if request.method != 'POST':
        return err('Method not allowed', 405)
    body = parse_body(request)
    token = str(body.get('token') or '').strip()
    pr = PasswordReset.objects.filter(token=token).first()
    if not pr or pr.used_at is not None or pr.expires_at < timezone.now():
        return JsonResponse({'valid': False})
    return JsonResponse({'valid': True, 'email': pr.email})


# ---------------------------------------------------------------------------
# Google OAuth
# ---------------------------------------------------------------------------

GOOGLE_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo'


def _verify_google_token(id_token):
    """Verify a Google ID token using Google's tokeninfo endpoint.
    Returns the token payload dict on success, None on failure."""
    try:
        resp = http_requests.get(
            GOOGLE_TOKENINFO_URL,
            params={'id_token': id_token},
            timeout=10,
        )
        if not resp.ok:
            return None
        payload = resp.json()
        # Verify the token was issued for our app
        client_id = os.environ.get('GOOGLE_CLIENT_ID', '')
        if client_id and payload.get('aud') != client_id:
            return None
        # Require email to be verified by Google
        if payload.get('email_verified') not in (True, 'true'):
            return None
        return payload
    except Exception:
        return None


@csrf_exempt
def google_auth(request):
    """Sign in or sign up with a Google ID token.

    POST /api/auth/google
    Body: {idToken: "<Google ID token from Sign-In button>"}

    Flow:
      1. Verify the token with Google.
      2. Look up an existing account by google_id or email.
      3. If found via email but registered with password, link the accounts.
      4. If not found, create a new account.
      5. Return {ok:true, user:{...}, isNew:bool}.
    """
    if request.method != 'POST':
        return err('Method not allowed', 405)
    body = parse_body(request)
    id_token = str(body.get('idToken') or '').strip()
    if not id_token:
        return err('idToken is required')

    payload = _verify_google_token(id_token)
    if not payload:
        return err('Invalid or expired Google token. Please try again.', 401)

    google_id = str(payload.get('sub') or '').strip()
    email = norm_email(payload.get('email') or '')
    full_name = str(payload.get('name') or '').strip()
    profile_pic = str(payload.get('picture') or '').strip()

    if not email or not google_id:
        return err('Google did not return an email address.', 400)

    is_new = False

    # Try to find by google_id first (returning Google user)
    user = AppUser.objects.filter(google_id=google_id).first()

    if not user:
        # Try by email (might be an existing email/password account)
        user = AppUser.objects.filter(email=email).first()
        if user:
            # Link the existing account to Google
            user.google_id = google_id
            user.auth_provider = 'google'
            if not user.profile_pic and profile_pic:
                user.profile_pic = profile_pic
            if not user.full_name and full_name:
                user.full_name = full_name
                user.initials = make_initials(full_name)
            user.save(update_fields=['google_id', 'auth_provider', 'profile_pic', 'full_name', 'initials'])
        else:
            # Create a brand-new account
            is_new = True
            user = AppUser.objects.create(
                full_name=full_name or email.split('@')[0],
                email=email,
                password='',
                initials=make_initials(full_name) if full_name else email[:2].upper(),
                role='recruitment',
                status='active',
                auth_provider='google',
                google_id=google_id,
                profile_pic=profile_pic,
            )

    if user.status != 'active':
        return err('This account is disabled. Contact your administrator.', 403)

    user_data = app_user_dict(user)
    user_data['profilePic'] = user.profile_pic or ''
    user_data['authProvider'] = user.auth_provider

    return JsonResponse({'ok': True, 'user': user_data, 'isNew': is_new})


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def _mask_email(email):
    try:
        name, domain = email.split('@', 1)
    except ValueError:
        return email
    if len(name) <= 2:
        masked = name[0] + '*'
    else:
        masked = name[0] + '*' * (len(name) - 2) + name[-1]
    return f'{masked}@{domain}'


def _request_origin(request):
    scheme = 'https' if request.is_secure() else request.scheme
    host = request.get_host()
    return f'{scheme}://{host}'
