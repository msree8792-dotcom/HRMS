"""
HRMS API views — a Django REST Framework port of the original Express server.

CRUD resources are implemented as DRF ``@api_view`` function views backed by
the serializers in ``serializers.py``. Request and response JSON shapes
(camelCase) match the Node API exactly so the existing React frontend works
unchanged.

A few helpers and endpoints are intentionally NOT DRF:
  * ``parse_body`` / ``err`` / ``make_initials`` / ``norm_email`` /
    ``app_user_dict`` are imported by ``auth_views`` and ``live_views`` and so
    are kept here.
  * ``recording_video`` handles a raw binary (video/webm) body, which DRF's
    JSON parser cannot consume, so it stays a plain ``csrf_exempt`` view.
  * ``spa_index`` serves the built React app for non-API routes.
"""
import json
import os
import re
import secrets
from datetime import datetime, timedelta

from django.conf import settings
from django.db.models import BooleanField, Case, Value, When
from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt

from rest_framework.decorators import api_view
from rest_framework.response import Response

from . import ai, mailer, social_poster
from .models import (
    AppUser,
    AttendanceEvent,
    EmployeeAttendance,
    EmployeeTask,
    InterviewLink,
    InterviewRecording,
    JobPost,
    LeaveRequest,
    QuestionSet,
    ResumeScore,
    UserDocument,
    UserEmailConfig,
    UserProfile,
    WorkSubmission,
)
from .serializers import (
    AppUserSerializer,
    AttendanceEventSerializer,
    EmployeeAttendanceSerializer,
    EmployeeTaskSerializer,
    InterviewLinkSerializer,
    InterviewRecordingSerializer,
    JobPostSerializer,
    LeaveRequestSerializer,
    ResumeScoreSerializer,
    UserDocumentSerializer,
    UserEmailConfigSerializer,
    UserProfileSerializer,
    WorkSubmissionSerializer,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def parse_body(request):
    try:
        return json.loads((request.body or b'{}').decode('utf-8') or '{}')
    except (ValueError, UnicodeDecodeError):
        return {}


def err(message, status=400):
    return JsonResponse({'message': message}, status=status)


def serializer_err(serializer, status=400):
    """Flatten DRF validation errors into the API's ``{'message': ...}`` shape."""
    msgs = []
    for field, errs in serializer.errors.items():
        first = errs[0] if isinstance(errs, (list, tuple)) and errs else errs
        msgs.append(f'{field}: {first}')
    return err('; '.join(msgs) or 'Invalid data', status)


def make_initials(name):
    parts = [p for p in re.split(r'\s+', (name or '').strip()) if p]
    return ''.join(p[0] for p in parts).upper()[:2]


def norm_email(value):
    return str(value or '').strip().lower()


def dt(value):
    return value.strftime('%Y-%m-%d %H:%M:%S') if value else None


def safe_list(value):
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, list) else []
        except ValueError:
            return []
    return []


def safe_json(value):
    if value is None:
        return None
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except ValueError:
        return None


def to_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------------------
# app_user_dict — kept for auth_views (which imports it). Mirrors
# AppUserSerializer's output exactly.
# ---------------------------------------------------------------------------
def app_user_dict(o):
    return {
        'id': o.id, 'name': o.full_name, 'email': o.email,
        'password': o.password, 'initials': o.initials,
        'role': o.role, 'status': o.status,
        'authProvider': o.auth_provider,
        'profilePic': o.profile_pic or '',
        'createdAt': dt(o.created_at),
    }


def resolve_color(type_value):
    v = str(type_value or '').lower()
    if 'contract' in v:
        return 'purple'
    if 'intern' in v:
        return 'orange'
    if 'part' in v:
        return 'green'
    return 'blue'


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------
@api_view(['GET', 'POST'])
def jobs(request):
    if request.method == 'GET':
        return Response(JobPostSerializer(JobPost.objects.all(), many=True).data)

    body = request.data
    if not body.get('title') or not body.get('dept'):
        return err('title and dept are required')
    serializer = JobPostSerializer(data=body)
    if not serializer.is_valid():
        return serializer_err(serializer)
    serializer.save()
    payload = serializer.data
    # Auto-post to the creator's linked social accounts (LinkedIn / X).
    # Non-fatal: a job is still created even if posting fails or isn't set up.
    if body.get('autoPost') is not False:
        payload['socialResults'] = _auto_post_job(payload, body.get('userEmail'))
    return Response(payload, status=201)


def _auto_post_job(job_payload, user_email=None):
    """Look up the user's saved social credentials and post the job. Returns a
    list of per-platform results (empty if nothing is configured)."""
    cfg = None
    if user_email:
        cfg = UserEmailConfig.objects.filter(pk=norm_email(user_email)).first()
    if not cfg:
        cfg = UserEmailConfig.objects.exclude(social__isnull=True).order_by('user_email').first()
    if not cfg:
        return []
    social = safe_json(cfg.social) or (cfg.social if isinstance(cfg.social, dict) else {})
    if not isinstance(social, dict) or not social:
        return []
    try:
        return social_poster.post_job(job_payload, social)
    except Exception as e:  # noqa: BLE001 - never break job creation on a posting error
        return [{'platform': 'all', 'ok': False, 'error': str(e)}]


# ---------------------------------------------------------------------------
# Interviews
# ---------------------------------------------------------------------------
# Default duration (hours) from creation time before interview link expires
INTERVIEW_LINK_EXPIRY_HOURS = 24


def _generate_interview_tokens(interview_date_str, interview_time_str):
    """Generate unique candidate + recruiter access tokens and compute expiry.

    The link stays valid for 24 hours from creation (now), ensuring candidates
    can access it anytime within that window.
    """
    candidate_token = secrets.token_urlsafe(32)
    recruiter_token = secrets.token_urlsafe(32)

    # Expiry is 24 hours from now, so links don't expire prematurely
    # regardless of when the interview is scheduled.
    expiry = datetime.now() + timedelta(hours=INTERVIEW_LINK_EXPIRY_HOURS)

    return candidate_token, recruiter_token, expiry


@api_view(['GET', 'POST'])
def interviews(request):
    if request.method == 'GET':
        # Newest first: the candidate portal matches an interview by email with
        # Array.find(), so the most recent row for a candidate must come first —
        # otherwise a stale older interview (with an old createdAt) is picked and
        # the link is wrongly shown as expired.
        qs = InterviewLink.objects.all().order_by('-id')
        return Response(InterviewLinkSerializer(qs, many=True).data)

    body = request.data
    name = body.get('name')
    email = body.get('email')
    role = body.get('role')
    interview_date = body.get('interviewDate')
    time = body.get('time')
    if not all([name, email, role, interview_date, time]):
        return err('name, email, role, interviewDate and time are required')

    serializer = InterviewLinkSerializer(data=body)
    if not serializer.is_valid():
        return serializer_err(serializer)
    c_token, r_token, expiry = _generate_interview_tokens(interview_date, time)
    serializer.save(candidate_token=c_token, recruiter_token=r_token, link_expires_at=expiry)
    return Response(serializer.data, status=201)


@api_view(['PUT'])
def interview_detail(request, pk):
    obj = InterviewLink.objects.filter(pk=pk).first()
    if not obj:
        return err('Interview not found', 404)
    serializer = InterviewLinkSerializer(obj, data=request.data, partial=True)
    if not serializer.is_valid():
        return serializer_err(serializer)
    serializer.save()
    return Response(serializer.data)


@api_view(['POST'])
def interviews_bulk_send_emails(request):
    """Send emails to multiple candidates (mark email_sent=True for their interviews)."""
    body = request.data
    interview_ids = body.get('interviewIds', [])
    if not isinstance(interview_ids, list) or len(interview_ids) == 0:
        return err('interviewIds array is required')

    qs = InterviewLink.objects.filter(id__in=interview_ids)
    if not qs.exists():
        return err('No interviews found with the provided IDs', 404)

    updated_count = qs.update(email_sent=True)
    updated_interviews = InterviewLinkSerializer(qs, many=True).data

    return JsonResponse({
        'ok': True,
        'message': f'Emails sent to {updated_count} candidate(s)',
        'count': updated_count,
        'interviews': updated_interviews,
    }, status=200)


# ---------------------------------------------------------------------------
# Follow-up emails (Selected / Waitlisted / Rejected) — sent server-side
# ---------------------------------------------------------------------------
def _followup_template(outcome, name, role, start_phrase='the first week of next month'):
    role = role or 'the role'
    name = name or 'there'
    o = str(outcome or '').strip().lower()
    if o == 'selected':
        subject = f'Congratulations! Offer for {role} at Eversoft'
        body = (
            f'Dear {name},<br><br>'
            f'We are delighted to let you know that you have been <strong>selected</strong> for the '
            f'<strong>{role}</strong> position at Eversoft. The whole panel was impressed by your '
            f'performance during the interview.<br><br>'
            f'Our HR team will reach out shortly with your offer details and onboarding steps. '
            f'We are looking forward to having you join us, with a tentative start in {start_phrase}.<br><br>'
            f'Warm regards,<br>The Eversoft Talent Team'
        )
    elif o == 'waitlisted':
        subject = f'Your application for {role} at Eversoft'
        body = (
            f'Dear {name},<br><br>'
            f'Thank you for interviewing for the <strong>{role}</strong> position. You did really well, '
            f'and we have placed your application on our <strong>waitlist</strong>. Should a suitable '
            f'opening become available, we will be in touch right away.<br><br>'
            f'We genuinely appreciate the time and energy you invested in the process.<br><br>'
            f'Warm regards,<br>The Eversoft Talent Team'
        )
    else:  # rejected / default
        subject = f'Update on your application for {role} at Eversoft'
        body = (
            f'Dear {name},<br><br>'
            f'Thank you for taking the time to interview for the <strong>{role}</strong> position and for '
            f'your interest in Eversoft. After careful consideration, we have decided not to move forward '
            f'with your application at this time.<br><br>'
            f'This was a difficult decision — we encourage you to apply for future roles that match your '
            f'skills. We wish you the very best in your job search.<br><br>'
            f'Warm regards,<br>The Eversoft Talent Team'
        )
    return subject, body


@api_view(['POST'])
def interview_send_followup(request):
    """Send a single follow-up email server-side (via the configured SMTP) and
    record the outcome on the interview row. Body:
        {interviewId, outcome}                      (looks up name/email/role)
      or {toEmail, toName, role, outcome}           (explicit)
      optional: senderEmail (whose SMTP to send from), subject, body
    """
    body = request.data
    outcome = body.get('outcome')
    obj = None
    interview_id = body.get('interviewId')
    if interview_id:
        obj = InterviewLink.objects.filter(pk=interview_id).first()
        if not obj:
            return err('Interview not found', 404)

    to_email = body.get('toEmail') or (obj.email if obj else None)
    to_name = body.get('toName') or (obj.name if obj else None)
    role = body.get('role') or (obj.role if obj else None)
    if not to_email:
        return err('toEmail (or a valid interviewId) is required')
    if not outcome:
        return err('outcome is required (Selected | Waitlisted | Rejected)')

    subject = body.get('subject')
    inner = body.get('body')
    if not subject or not inner:
        subject, inner = _followup_template(outcome, to_name, role)

    html = mailer.render_branded(
        title=subject,
        intro='',
        highlight_html=f'<div style="font-size:15px;line-height:1.7;color:#334155;">{inner}</div>',
    )
    result = mailer.send_email(
        to=to_email, subject=subject, html=html,
        text=re.sub(r'<[^>]+>', '', inner.replace('<br>', '\n')),
        sender_email=body.get('senderEmail'),
    )
    if not result.get('ok'):
        return err('Could not send the follow-up email: ' + result.get('error', 'unknown error'), 502)

    if obj:
        obj.outcome = outcome
        obj.email_sent = True
        obj.save(update_fields=['outcome', 'email_sent'])
    return Response({'ok': True, 'message': f'Follow-up sent to {to_name or to_email}.'})


# ---------------------------------------------------------------------------
# Interview token verification & link management
# ---------------------------------------------------------------------------
@api_view(['POST'])
def interview_verify_token(request):
    """Verify a candidate or recruiter interview access token.

    POST /api/interviews/verify-token
    Body: {token: "<candidate_token or recruiter_token>"}

    Returns the interview details and whether the link is still valid.
    """
    body = request.data
    token = str(body.get('token') or '').strip()
    if not token:
        return err('token is required')

    # Determine token type (candidate or recruiter)
    obj = InterviewLink.objects.filter(candidate_token=token).first()
    token_type = 'candidate'
    if not obj:
        obj = InterviewLink.objects.filter(recruiter_token=token).first()
        token_type = 'recruiter'

    if not obj:
        return JsonResponse({'valid': False, 'reason': 'Token not found'}, status=404)

    now = datetime.now()

    # Check expiry
    if obj.link_expires_at and now > obj.link_expires_at:
        # Auto-update status to Expired
        if obj.status not in ('Completed', 'Expired'):
            obj.status = 'Expired'
            obj.save(update_fields=['status'])
        return JsonResponse({
            'valid': False,
            'reason': 'Interview link has expired',
            'expiredAt': dt(obj.link_expires_at),
            'interviewId': obj.id,
        })

    # Mark as Active when first accessed
    if obj.status == 'Scheduled':
        obj.status = 'Active'
        obj.save(update_fields=['status'])

    data = InterviewLinkSerializer(obj).data
    data['tokenType'] = token_type
    data['valid'] = True
    return Response(data)


@api_view(['POST'])
def interview_regenerate_link(request, pk):
    """Regenerate candidate and recruiter tokens for an interview.

    POST /api/interviews/<id>/regenerate-link
    Body: {extendHours: 48}  (optional, default=24)
    """
    obj = InterviewLink.objects.filter(pk=pk).first()
    if not obj:
        return err('Interview not found', 404)

    body = request.data
    extend_hours = int(body.get('extendHours') or INTERVIEW_LINK_EXPIRY_HOURS)

    c_token = secrets.token_urlsafe(32)
    r_token = secrets.token_urlsafe(32)
    # Extend from interview date if available, otherwise from now
    new_expiry, _, _ = _generate_interview_tokens(
        obj.interview_date or '', obj.interview_time or ''
    )
    # Allow explicit override
    if body.get('extendHours'):
        new_expiry = datetime.now() + timedelta(hours=extend_hours)

    obj.candidate_token = c_token
    obj.recruiter_token = r_token
    obj.link_expires_at = new_expiry
    if obj.status == 'Expired':
        obj.status = 'Scheduled'
    obj.save(update_fields=['candidate_token', 'recruiter_token', 'link_expires_at', 'status'])

    return Response({
        'ok': True,
        'candidateToken': c_token,
        'recruiterToken': r_token,
        'linkExpiresAt': dt(new_expiry),
        'message': 'Interview links regenerated successfully.',
    })


@api_view(['POST'])
def interview_resend_invitation(request, pk):
    """Resend the interview invitation email to the candidate.

    POST /api/interviews/<id>/resend-invitation
    Body: {senderEmail, origin}  (optional)
    """
    obj = InterviewLink.objects.filter(pk=pk).first()
    if not obj:
        return err('Interview not found', 404)

    body = request.data
    origin = body.get('origin') or _request_origin_from_meta(request)

    # Regenerate tokens before resending so the new link is fresh
    c_token = secrets.token_urlsafe(32)
    r_token = secrets.token_urlsafe(32)
    new_expiry, _, _ = _generate_interview_tokens(
        obj.interview_date or '', obj.interview_time or ''
    )
    obj.candidate_token = c_token
    obj.recruiter_token = r_token
    obj.link_expires_at = new_expiry
    obj.email_sent = False
    obj.save(update_fields=['candidate_token', 'recruiter_token', 'link_expires_at', 'email_sent'])

    candidate_url = f'{origin}/interview-access?token={c_token}'
    recruiter_url = f'{origin}/interview-access?token={r_token}'

    html = mailer.render_branded(
        title=f'Interview Invitation — {obj.role}',
        intro=(
            f'Dear {obj.name},<br><br>'
            f'Your interview for the <strong>{obj.role}</strong> position has been scheduled.<br>'
            f'<strong>Date:</strong> {obj.interview_date or "TBD"}&nbsp;&nbsp;'
            f'<strong>Time:</strong> {obj.interview_time or "TBD"}<br>'
            f'<strong>Platform:</strong> {obj.platform or "To be confirmed"}<br><br>'
            f'Click the button below to join your interview session at the scheduled time.'
        ),
        highlight_html=(
            f'<div style="text-align:center;margin:18px 0;">'
            f'<a href="{candidate_url}" target="_blank" rel="noreferrer noopener" '
            f'style="display:inline-block;background:linear-gradient(135deg,#4f8ef7,#a855f7);'
            f'color:#fff;font-size:15px;font-weight:700;text-decoration:none;'
            f'padding:14px 38px;border-radius:10px;">Join Interview</a></div>'
            f'<div style="text-align:center;"><a href="{candidate_url}" '
            f'style="color:#94a3b8;font-size:12px;word-break:break-all;">{candidate_url}</a></div>'
        ),
        footer=(
            f'This link is valid for 24 hours from now. '
            f'If you encounter any issues, contact your recruiter.'
        ),
    )
    text = (
        f'Hi {obj.name},\n\nYour interview for {obj.role} is scheduled on '
        f'{obj.interview_date} at {obj.interview_time}.\n\n'
        f'Join here: {candidate_url}\n\n'
        f'This link expires in 24 hours. If you cannot join by then, contact your recruiter for a new link.'
    )
    result = mailer.send_email(
        to=obj.email,
        subject=f'Interview Invitation — {obj.role}',
        html=html,
        text=text,
        sender_email=body.get('senderEmail'),
    )
    if not result.get('ok'):
        return err('Could not send invitation: ' + result.get('error', 'unknown error'), 502)

    obj.email_sent = True
    obj.save(update_fields=['email_sent'])

    return Response({
        'ok': True,
        'message': f'Invitation resent to {obj.email}.',
        'candidateToken': c_token,
        'recruiterToken': r_token,
        'recruiterUrl': recruiter_url,
    })


def _request_origin_from_meta(request):
    scheme = 'https' if request.is_secure() else request.scheme
    host = request.get_host()
    return f'{scheme}://{host}'


# ---------------------------------------------------------------------------
# Resume Scores
# ---------------------------------------------------------------------------
# Minimum qualifying score; resumes below this are not stored in the DB.
RESUME_SCORE_MIN = 75


@api_view(['GET', 'POST'])
def resume_scores(request):
    if request.method == 'GET':
        return Response(ResumeScoreSerializer(ResumeScore.objects.all(), many=True).data)

    body = request.data
    if isinstance(body, list):
        if len(body) == 0:
            return err('resume upload array is required')
        created = []
        for item in body:
            if not item.get('name') and item.get('fileName'):
                item['name'] = os.path.splitext(item.get('fileName'))[0]
            serializer = ResumeScoreSerializer(data=item)
            if not serializer.is_valid():
                return serializer_err(serializer)
            score_val = int(serializer.validated_data.get('score') or 0)
            if score_val < RESUME_SCORE_MIN:
                return Response(
                    {
                        'stored': False,
                        'score': score_val,
                        'threshold': RESUME_SCORE_MIN,
                        'message': f'Score {score_val} is below the minimum of {RESUME_SCORE_MIN}; not stored.',
                    },
                    status=422,
                )
            serializer.save()
            created.append(serializer.data)
        return Response(created, status=201)

    if not body.get('name') and body.get('fileName'):
        body['name'] = os.path.splitext(body.get('fileName'))[0]
    if not body.get('name'):
        return err('name is required')
    serializer = ResumeScoreSerializer(data=body)
    if not serializer.is_valid():
        return serializer_err(serializer)

    # Only persist resumes that meet the qualifying score threshold.
    try:
        score_val = int(serializer.validated_data.get('score') or 0)
    except (TypeError, ValueError):
        score_val = 0
    if score_val < RESUME_SCORE_MIN:
        # Return a non-2xx status so the frontend's fetch helper treats this as
        # "not saved" (it only appends a row on a 2xx record response). A 2xx
        # here would push a non-record object into the UI list and crash render.
        return Response(
            {
                'stored': False,
                'score': score_val,
                'threshold': RESUME_SCORE_MIN,
                'message': f'Score {score_val} is below the minimum of {RESUME_SCORE_MIN}; not stored.',
            },
            status=422,
        )

    serializer.save()
    return Response(serializer.data, status=201)


# ---------------------------------------------------------------------------
# Interview Recordings
# ---------------------------------------------------------------------------
def _recording_list_qs():
    return InterviewRecording.objects.annotate(
        _has_video=Case(
            When(video_buffer__isnull=False, then=Value(True)),
            default=Value(False), output_field=BooleanField(),
        ),
        _has_recording=Case(
            When(recording_data__isnull=False, then=Value(True)),
            default=Value(False), output_field=BooleanField(),
        ),
    ).defer('video_buffer', 'recording_data')


RECORDING_FIELD_MAP = {
    'candidateName': 'candidate_name', 'candidateEmail': 'candidate_email',
    'role': 'role', 'duration': 'duration', 'verdict': 'verdict',
    'totalScore': 'total_score', 'techScore': 'tech_score',
    'commScore': 'comm_score', 'integrityScore': 'integrity_score',
    'recordingData': 'recording_data', 'transcript': 'transcript',
    'responses': 'responses',
}


@api_view(['GET', 'POST'])
def recordings(request):
    if request.method == 'GET':
        return Response(InterviewRecordingSerializer(_recording_list_qs(), many=True).data)

    body = request.data
    if not body.get('candidateName'):
        return err('candidateName is required')
    serializer = InterviewRecordingSerializer(data=body)
    if not serializer.is_valid():
        return serializer_err(serializer)
    serializer.save()
    return Response(serializer.data, status=201)


@api_view(['GET', 'PUT', 'DELETE'])
def recording_detail(request, pk):
    obj = InterviewRecording.objects.filter(pk=pk).first()
    if not obj:
        return err('Recording not found', 404)

    if request.method == 'GET':
        data = InterviewRecordingSerializer(obj).data
        data['recordingData'] = obj.recording_data
        return Response(data)

    if request.method == 'PUT':
        body = request.data
        changed = False
        for key, value in body.items():
            col = RECORDING_FIELD_MAP.get(key)
            if not col:
                continue
            if col == 'responses':
                setattr(obj, col, value if isinstance(value, list) else [])
            else:
                setattr(obj, col, value)
            changed = True
        if changed:
            obj.save()
        return Response({'ok': True, 'id': obj.id})

    # DELETE
    obj.delete()
    return Response({'ok': True})


@csrf_exempt
def recording_video(request, pk):
    """Binary (video/webm) upload + download. Kept as a plain Django view
    because DRF's JSON parser cannot consume a raw binary body."""
    obj = InterviewRecording.objects.filter(pk=pk).first()
    if not obj:
        return err('Recording not found', 404)

    if request.method == 'POST':
        data = request.body
        if not data:
            return err('Invalid or empty video payload')
        mime = (request.META.get('CONTENT_TYPE') or 'video/webm').split(';')[0]
        obj.video_buffer = data
        obj.video_mime = mime
        obj.save(update_fields=['video_buffer', 'video_mime'])
        return JsonResponse({'ok': True})

    if request.method == 'GET':
        if not obj.video_buffer:
            return err('No video data for this recording', 404)
        payload = bytes(obj.video_buffer)
        resp = HttpResponse(payload, content_type=obj.video_mime or 'video/webm')
        resp['Content-Length'] = str(len(payload))
        resp['Accept-Ranges'] = 'bytes'
        resp['Cache-Control'] = 'public, max-age=31536000'
        return resp

    return err('Method not allowed', 405)


# ---------------------------------------------------------------------------
# Question Sets
# ---------------------------------------------------------------------------
@api_view(['POST'])
def question_sets(request):
    body = request.data
    questions = body.get('questions')
    if not isinstance(questions, list) or len(questions) == 0:
        return JsonResponse({'error': 'questions array required'}, status=400)
    new_id = 'q_' + secrets.token_hex(4)
    QuestionSet.objects.create(id=new_id, questions=questions)
    return Response({'id': new_id})


@api_view(['GET'])
def question_set_detail(request, set_id):
    obj = QuestionSet.objects.filter(pk=set_id).first()
    if not obj:
        return JsonResponse({'error': 'Not found'}, status=404)
    return Response({'questions': safe_list(obj.questions)})


# ---------------------------------------------------------------------------
# AI proxy
# ---------------------------------------------------------------------------
@api_view(['GET'])
def ai_status(request):
    available = ai.check_ai_key_valid(request.headers.get('x-api-key'))
    return Response({'available': available})


@api_view(['POST'])
def ai_generate_questions(request):
    """Generate interview questions.

    Supports two modes:
      Legacy: {prompt: "..."}
      Enhanced: {resumeText, jdText, jobRole, experienceLevel, skills, candidateName, questionCount}
    """
    body = request.data
    prompt = body.get('prompt') or ''
    params = {
        'resumeText': body.get('resumeText') or body.get('resume_text') or '',
        'jdText': body.get('jdText') or body.get('jd_text') or '',
        'jobRole': body.get('jobRole') or body.get('job_role') or '',
        'experienceLevel': body.get('experienceLevel') or body.get('experience_level') or 'Mid-level',
        'skills': body.get('skills') or [],
        'candidateName': body.get('candidateName') or body.get('candidate_name') or '',
        'questionCount': body.get('questionCount') or body.get('question_count') or 10,
    }
    has_structured = any([params['resumeText'], params['jdText'], params['jobRole']])
    if not prompt and not has_structured:
        return JsonResponse({'error': {'message': 'prompt or structured params (resumeText/jdText/jobRole) are required'}}, status=400)

    payload = ai.generate_questions(
        prompt,
        request_key=request.headers.get('x-api-key'),
        params=params if has_structured else None,
    )
    return Response(payload)


# ---------------------------------------------------------------------------
# User Settings
# ---------------------------------------------------------------------------
@api_view(['POST','GET'])
def user_settings(request, email):
    email = norm_email(email)
    if not email:
        return err('email is required')
    profile = UserProfile.objects.filter(pk=email).first()
    email_cfg = UserEmailConfig.objects.filter(pk=email).first()
    docs = UserDocument.objects.filter(user_email=email)
    return Response({
        'profile': UserProfileSerializer(profile).data if profile else None,
        'emailConfig': UserEmailConfigSerializer(email_cfg).data if email_cfg else None,
        'documents': UserDocumentSerializer(docs, many=True).data,
    })


@api_view(['PUT'])
def user_profile(request, email):
    email = norm_email(email)
    if not email:
        return err('email is required')
    body = request.data
    obj, _ = UserProfile.objects.update_or_create(
        email=email,
        defaults={
            'first_name': body.get('firstName', ''),
            'last_name': body.get('lastName', ''),
            'phone': body.get('phone', ''),
            'alt_email': body.get('altEmail', ''),
            'blood_group': body.get('bloodGroup', ''),
            'department': body.get('department', ''),
            'designation': body.get('designation', ''),
            'address': body.get('address', ''),
            'profile_pic': body.get('profilePic', ''),
        },
    )
    return Response(UserProfileSerializer(obj).data)


@api_view(['PUT'])
def user_email_config(request, email):
    email = norm_email(email)
    if not email:
        return err('email is required')
    body = request.data
    social = body.get('social', {})
    obj, _ = UserEmailConfig.objects.update_or_create(
        user_email=email,
        defaults={
            'smtp_host': body.get('smtpHost', ''),
            'smtp_port': str(body.get('smtpPort', '') or ''),
            'smtp_user': body.get('smtpUser', ''),
            'smtp_password': body.get('smtpPassword', ''),
            'smtp_secure': bool(body.get('smtpSecure', False)),
            'from_name': body.get('fromName', ''),
            'from_email': body.get('fromEmail', ''),
            'social': social if isinstance(social, dict) else {},
        },
    )
    return Response(UserEmailConfigSerializer(obj).data)


@api_view(['POST'])
def user_documents(request, email):
    email = norm_email(email)
    body = request.data
    doc_type = body.get('docType')
    file_data = body.get('fileData')
    if not email or not doc_type or not file_data:
        return err('email, docType and fileData are required')
    obj, _ = UserDocument.objects.update_or_create(
        user_email=email, doc_type=doc_type,
        defaults={
            'file_name': body.get('fileName', ''),
            'file_mime': body.get('fileMime', ''),
            'file_data': file_data,
        },
    )
    return Response(UserDocumentSerializer(obj).data, status=201)


@api_view(['GET', 'DELETE'])
def user_document_detail(request, email, doc_type):
    email = norm_email(email)
    if request.method == 'GET':
        doc = UserDocument.objects.filter(user_email=email, doc_type=doc_type).first()
        if not doc:
            return err('Document not found', 404)
        return Response(UserDocumentSerializer(doc, include_data=True).data)

    # DELETE
    deleted, _ = UserDocument.objects.filter(user_email=email, doc_type=doc_type).delete()
    if deleted == 0:
        return err('Document not found', 404)
    return Response({'ok': True})


# ---------------------------------------------------------------------------
# App Users (Settings -> User Access logins)
# Backs services/usersApi.js: every login created in the app is stored in the
# `app_users` table so it persists in MySQL, not just browser localStorage.
# ---------------------------------------------------------------------------
@api_view(['GET', 'POST'])
def users(request):
    if request.method == 'GET':
        return Response(AppUserSerializer(AppUser.objects.all(), many=True).data)

    body = request.data
    name = str(body.get('name') or '').strip()
    email = norm_email(body.get('email'))
    password = body.get('password') or ''
    if not name or not email or not password:
        return err('name, email and password are required')
    if AppUser.objects.filter(email=email).exists():
        return err('A login with this email already exists', 409)
    serializer = AppUserSerializer(data={**body, 'name': name, 'email': email})
    if not serializer.is_valid():
        return serializer_err(serializer)
    serializer.save()
    return Response(serializer.data, status=201)


@api_view(['PUT', 'DELETE'])
def user_detail(request, email):
    email = norm_email(email)
    if not email:
        return err('email is required')
    obj = AppUser.objects.filter(email=email).first()
    if not obj:
        return err('User not found', 404)

    if request.method == 'PUT':
        body = request.data
        if body.get('name'):
            obj.full_name = str(body['name']).strip()
            obj.initials = make_initials(obj.full_name)
        if body.get('password'):
            obj.password = body['password']
        if body.get('role'):
            obj.role = body['role']
        if body.get('status'):
            obj.status = body['status']
        obj.save()
        return Response(AppUserSerializer(obj).data)

    # DELETE
    obj.delete()
    return Response({'ok': True})


# ===========================================================================
# Employees module — Attendance / Check-In-Out · Leave · Tasks · Submissions
# ===========================================================================
# An employee whose first check-in lands after this time is marked "late".
ATTENDANCE_LATE_AFTER = (9, 30)  # 09:30

DEFAULT_LEAVE_ALLOWANCE = [
    ('Casual Leave', 12),
    ('Sick Leave', 12),
    ('Earned Leave', 15),
]


def parse_date(value):
    """Parse a 'YYYY-MM-DD' string into a date (None if blank/invalid)."""
    if not value:
        return None
    try:
        return datetime.strptime(str(value).strip()[:10], '%Y-%m-%d').date()
    except (ValueError, TypeError):
        return None


# --- Attendance + Check-In / Check-Out -------------------------------------
@api_view(['GET'])
def attendance(request):
    """List attendance rows, filterable by ?email=, ?date=, ?from=, ?to=."""
    qs = EmployeeAttendance.objects.all()
    email = norm_email(request.GET.get('email'))
    if email:
        qs = qs.filter(email=email)
    exact = parse_date(request.GET.get('date'))
    if exact:
        qs = qs.filter(date=exact)
    frm = parse_date(request.GET.get('from'))
    if frm:
        qs = qs.filter(date__gte=frm)
    to = parse_date(request.GET.get('to'))
    if to:
        qs = qs.filter(date__lte=to)
    return Response(EmployeeAttendanceSerializer(qs, many=True).data)


def _is_checked_in(obj):
    """True when there is an open work session (checked in after last checkout)."""
    return bool(obj.check_in and (obj.check_out is None or obj.check_in > obj.check_out))


@api_view(['POST'])
def attendance_check_in(request):
    """Start a work session. Re-checking-in later the same day starts a new
    session; previously accumulated ``worked_minutes`` are preserved."""
    body = request.data
    email = norm_email(body.get('email'))
    if not email:
        return err('email is required')
    now = datetime.now()
    obj, created = EmployeeAttendance.objects.get_or_create(email=email, date=now.date())
    name = body.get('employee') or body.get('name') or ''
    if name:
        obj.employee_name = name
    if body.get('device'):
        obj.device = body.get('device')
    # Status (present/late) is decided by the first check-in of the day only.
    if created:
        obj.status = 'late' if (now.hour, now.minute) > ATTENDANCE_LATE_AFTER else 'present'
    # Start a new session: stamp the session start, leave worked_minutes intact.
    obj.check_in = now
    obj.save()
    # Drop a "Check In" event onto today's activity log / team status feed.
    AttendanceEvent.objects.create(
        email=email, employee_name=obj.employee_name, date=now.date(),
        event='check-in', location=('Home' if obj.device == 'mobile' else 'Office'),
        at=now,
    )
    return Response(EmployeeAttendanceSerializer(obj).data, status=201)


@api_view(['POST'])
def attendance_check_out(request):
    """Close the open work session, ADDING its minutes to the running total so
    multiple check-in/out cycles in one day accumulate."""
    body = request.data
    email = norm_email(body.get('email'))
    if not email:
        return err('email is required')
    now = datetime.now()
    obj = EmployeeAttendance.objects.filter(email=email, date=now.date()).first()
    if not obj:
        return err('No check-in found for today', 404)
    if _is_checked_in(obj):
        session = max(int((now - obj.check_in).total_seconds() // 60), 0)
        obj.worked_minutes = (obj.worked_minutes or 0) + session
    obj.check_out = now
    obj.presence = ''          # leaving for the day clears live presence
    obj.presence_at = now
    obj.save()
    AttendanceEvent.objects.create(
        email=email, employee_name=obj.employee_name, date=now.date(),
        event='check-out', location='', at=now,
    )
    return Response(EmployeeAttendanceSerializer(obj).data)


@api_view(['GET'])
def attendance_today(request):
    """Today's attendance snapshot for ?email= (used by the check-in widget)."""
    email = norm_email(request.GET.get('email'))
    if not email:
        return err('email is required')
    obj = EmployeeAttendance.objects.filter(email=email, date=datetime.now().date()).first()
    if not obj:
        return Response({
            'email': email, 'date': datetime.now().strftime('%Y-%m-%d'),
            'checkedIn': False, 'checkIn': None, 'checkOut': None,
            'workedMinutes': 0, 'status': 'absent',
        })
    return Response(EmployeeAttendanceSerializer(obj).data)


@api_view(['PUT', 'DELETE'])
def attendance_detail(request, pk):
    """Manual edit / removal of an attendance row (HR/admin)."""
    obj = EmployeeAttendance.objects.filter(pk=pk).first()
    if not obj:
        return err('Attendance record not found', 404)
    if request.method == 'DELETE':
        obj.delete()
        return Response({'ok': True})
    serializer = EmployeeAttendanceSerializer(obj, data=request.data, partial=True)
    if not serializer.is_valid():
        return serializer_err(serializer)
    serializer.save()
    return Response(serializer.data)


# --- Activity Log + Team Status (attendance_events) ------------------------
# Valid activity-log event types (mirrors ATTENDANCE_EVENT_LABELS).
ATTENDANCE_EVENT_TYPES = (
    'check-in', 'check-out', 'break-start', 'break-end',
    'remote-switch', 'office-switch',
)


@api_view(['GET', 'POST'])
def attendance_events(request):
    """GET: today's (or ?date=) activity-log events for ?email=.
    POST: append an event (break / mode switch) to the signed-in user's day."""
    if request.method == 'GET':
        day = parse_date(request.GET.get('date')) or datetime.now().date()
        qs = AttendanceEvent.objects.filter(date=day)
        email = norm_email(request.GET.get('email'))
        if email:
            qs = qs.filter(email=email)
        return Response(AttendanceEventSerializer(qs, many=True).data)

    body = request.data
    email = norm_email(body.get('email'))
    event = str(body.get('event') or body.get('type') or '').strip()
    if not email:
        return err('email is required')
    if event not in ATTENDANCE_EVENT_TYPES:
        return err('event must be one of: ' + ', '.join(ATTENDANCE_EVENT_TYPES))
    now = datetime.now()
    obj = AttendanceEvent.objects.create(
        email=email,
        employee_name=body.get('employee') or body.get('name') or '',
        date=now.date(),
        event=event,
        location=str(body.get('location') or '').strip(),
        at=now,
    )
    # Keep the day's presence in step with break transitions so the Team Status
    # panel matches the activity log (start break -> Away; end break -> clear).
    if event in ('break-start', 'break-end'):
        att = EmployeeAttendance.objects.filter(email=email, date=now.date()).first()
        if att:
            att.presence = 'Away' if event == 'break-start' else ''
            att.presence_at = now
            att.save()
    return Response(AttendanceEventSerializer(obj).data, status=201)


@api_view(['POST'])
def attendance_presence(request):
    """Set the signed-in employee's live presence (the STATUS picker:
    Available / Away / Busy / Do not disturb / ...). Valid only while checked
    in. Selecting 'Away' logs a Break Start on the activity log (and leaving
    'Away' logs a Break End) so the timeline stays consistent."""
    body = request.data
    email = norm_email(body.get('email'))
    label = str(body.get('label') or '').strip()
    if not email:
        return err('email is required')
    if not label:
        return err('label is required')
    now = datetime.now()
    att = EmployeeAttendance.objects.filter(email=email, date=now.date()).first()
    if not att or not _is_checked_in(att):
        return err('Presence can only be set while checked in', 409)
    prev = att.presence or ''
    name = att.employee_name or body.get('employee') or body.get('name') or ''
    if label == 'Away' and prev != 'Away':
        AttendanceEvent.objects.create(
            email=email, employee_name=name, date=now.date(),
            event='break-start', location='', at=now,
        )
    elif prev == 'Away' and label != 'Away':
        AttendanceEvent.objects.create(
            email=email, employee_name=name, date=now.date(),
            event='break-end',
            location=('Home' if att.device == 'mobile' else 'Office'), at=now,
        )
    att.presence = label
    att.presence_at = now
    att.save()
    return Response(EmployeeAttendanceSerializer(att).data)


def _team_status(event, att):
    """Live status label + 'since' datetime for the Team Status panel. An
    explicit presence choice (STATUS picker / break) wins; otherwise we fall
    back to the location implied by the latest activity event. Checked-out or
    no-show employees are Absent."""
    if att is None or not _is_checked_in(att):
        return 'Absent', None
    if att.presence:
        return att.presence, (att.presence_at or att.check_in)
    if event is not None:
        e = event.event
        if e in ('check-in', 'office-switch', 'break-end'):
            loc = (event.location or '').lower()
            remote = 'home' in loc or 'remote' in loc
            return ('Remote' if remote else 'In Office'), event.at
        if e == 'remote-switch':
            return 'Remote', event.at
        if e == 'break-start':
            return 'On Break', event.at
    return ('Remote' if att.device == 'mobile' else 'In Office'), att.check_in


@api_view(['GET'])
def attendance_team(request):
    """Live presence snapshot for the whole team (Team Status Now panel).
    Status per person comes from their latest activity event today, else from
    their attendance record; everyone else is shown as Absent."""
    today = datetime.now().date()

    # Latest event per email today (queryset is ordered by ``at`` ascending, so
    # the last write per email wins) + the best name we have seen for them.
    latest_event = {}
    event_name = {}
    for ev in AttendanceEvent.objects.filter(date=today):
        latest_event[ev.email] = ev
        if ev.employee_name:
            event_name[ev.email] = ev.employee_name
    today_att = {a.email: a for a in EmployeeAttendance.objects.filter(date=today)}

    # Roster = all app users, plus any email that has activity but no login row.
    roster = [(u.email, u.full_name) for u in AppUser.objects.all()]
    known = {e for e, _ in roster}
    for email in set(list(latest_event.keys()) + list(today_att.keys())):
        if email not in known:
            att = today_att.get(email)
            roster.append((email, event_name.get(email) or (att.employee_name if att else '')))

    priority = {'In Office': 0, 'Remote': 1, 'On Break': 2, 'Absent': 3}
    rows = []
    for email, name in roster:
        att = today_att.get(email)
        status, since_dt = _team_status(latest_event.get(email), att)
        display = (name or event_name.get(email)
                   or (att.employee_name if att else '') or email.split('@')[0])
        rows.append({
            'email': email,
            'name': display,
            'status': status,
            'since': since_dt.strftime('%I:%M %p') if since_dt else '—',
        })
    rows.sort(key=lambda r: (priority.get(r['status'], 9), r['name'].lower()))
    return Response(rows)


# --- Leave Management ------------------------------------------------------
@api_view(['GET', 'POST'])
def leave(request):
    if request.method == 'GET':
        qs = LeaveRequest.objects.all()
        email = norm_email(request.GET.get('email'))
        if email:
            qs = qs.filter(email=email)
        status_filter = request.GET.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)
        return Response(LeaveRequestSerializer(qs, many=True).data)

    body = request.data
    email = norm_email(body.get('email'))
    if not email:
        return err('email is required')
    if not body.get('fromDate') or not body.get('toDate'):
        return err('fromDate and toDate are required')
    serializer = LeaveRequestSerializer(data={**body, 'email': email})
    if not serializer.is_valid():
        return serializer_err(serializer)
    serializer.save()
    return Response(serializer.data, status=201)


@api_view(['PUT', 'DELETE'])
def leave_detail(request, pk):
    obj = LeaveRequest.objects.filter(pk=pk).first()
    if not obj:
        return err('Leave request not found', 404)
    if request.method == 'DELETE':
        obj.delete()
        return Response({'ok': True})
    serializer = LeaveRequestSerializer(obj, data=request.data, partial=True)
    if not serializer.is_valid():
        return serializer_err(serializer)
    serializer.save()
    return Response(serializer.data)


@api_view(['GET'])
def leave_balance(request):
    """Per-type leave balance for ?email= (allowance − approved days)."""
    email = norm_email(request.GET.get('email'))
    if not email:
        return err('email is required')
    used = {}
    for lr in LeaveRequest.objects.filter(email=email, status='Approved'):
        used[lr.type] = used.get(lr.type, 0) + (lr.days or 0)
    balances = [
        {'type': typ, 'allowance': allowance,
         'used': used.get(typ, 0), 'remaining': max(allowance - used.get(typ, 0), 0)}
        for typ, allowance in DEFAULT_LEAVE_ALLOWANCE
    ]
    return Response({'email': email, 'balances': balances})


# --- Task Tracker ----------------------------------------------------------
@api_view(['GET', 'POST'])
def tasks(request):
    if request.method == 'GET':
        qs = EmployeeTask.objects.all()
        assignee = request.GET.get('assignee')
        if assignee:
            qs = qs.filter(assignee=assignee)
        assignee_email = norm_email(request.GET.get('assigneeEmail'))
        if assignee_email:
            qs = qs.filter(assignee_email=assignee_email)
        stage = request.GET.get('stage')
        if stage:
            qs = qs.filter(stage=stage)
        return Response(EmployeeTaskSerializer(qs, many=True).data)

    body = request.data
    if not body.get('title'):
        return err('title is required')
    serializer = EmployeeTaskSerializer(data=body)
    if not serializer.is_valid():
        return serializer_err(serializer)
    serializer.save()
    return Response(serializer.data, status=201)


@api_view(['PUT', 'DELETE'])
def task_detail(request, pk):
    obj = EmployeeTask.objects.filter(pk=pk).first()
    if not obj:
        return err('Task not found', 404)
    if request.method == 'DELETE':
        obj.delete()
        return Response({'ok': True})
    serializer = EmployeeTaskSerializer(obj, data=request.data, partial=True)
    if not serializer.is_valid():
        return serializer_err(serializer)
    serializer.save()
    return Response(serializer.data)


# --- Work Submissions ------------------------------------------------------
@api_view(['GET', 'POST'])
def submissions(request):
    if request.method == 'GET':
        qs = WorkSubmission.objects.all()
        email = norm_email(request.GET.get('email'))
        if email:
            qs = qs.filter(email=email)
        status_filter = request.GET.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)
        return Response(WorkSubmissionSerializer(qs, many=True).data)

    body = request.data
    email = norm_email(body.get('email'))
    if not email:
        return err('email is required')
    if not body.get('title'):
        return err('title is required')
    serializer = WorkSubmissionSerializer(data={**body, 'email': email})
    if not serializer.is_valid():
        return serializer_err(serializer)
    serializer.save()
    return Response(serializer.data, status=201)


@api_view(['PUT', 'DELETE'])
def submission_detail(request, pk):
    obj = WorkSubmission.objects.filter(pk=pk).first()
    if not obj:
        return err('Submission not found', 404)
    if request.method == 'DELETE':
        obj.delete()
        return Response({'ok': True})
    serializer = WorkSubmissionSerializer(obj, data=request.data, partial=True)
    if not serializer.is_valid():
        return serializer_err(serializer)
    serializer.save()
    return Response(serializer.data)


# ---------------------------------------------------------------------------
# Public client config (exposes safe, non-secret settings to the frontend)
# ---------------------------------------------------------------------------
@api_view(['GET'])
def client_config(request):
    """Return public configuration needed by the frontend JS.
    Only expose values that are safe to be public (e.g. OAuth client IDs).
    """
    import os
    return Response({
        'googleClientId': os.environ.get('GOOGLE_CLIENT_ID', ''),
    })


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
@api_view(['GET'])
def health(request):
    return Response({
        'ok': True, 'mode': 'mysql', 'database': settings.DATABASES['default']['NAME'],
        'jobs': JobPost.objects.count(),
        'interviews': InterviewLink.objects.count(),
        'resumeScores': ResumeScore.objects.count(),
        'recordings': InterviewRecording.objects.count(),
        'appUsers': AppUser.objects.count(),
    })


# ---------------------------------------------------------------------------
# SPA fallback — serve the built React index.html for all non-API routes.
# ---------------------------------------------------------------------------
_INDEX_BYTES = None


def spa_index(request):
    global _INDEX_BYTES
    index_path = settings.REACT_BUILD_DIR / 'index.html'
    if not index_path.exists():
        return HttpResponse(
            '<h1>React build not found</h1>'
            f'<p>Expected {index_path}. Run <code>npm run build</code> in the '
            'project root, or set REACT_BUILD_DIR in .env.</p>',
            status=200, content_type='text/html',
        )
    if _INDEX_BYTES is None or settings.DEBUG:
        _INDEX_BYTES = index_path.read_bytes()
    return HttpResponse(_INDEX_BYTES, content_type='text/html')
