"""
Models mapped 1:1 onto the existing MySQL tables created by the original
Node/Express server. Table and column names match exactly so the same
database can be used without migrating data.
"""
from django.db import models


class JobPost(models.Model):
    title = models.CharField(max_length=255)
    dept = models.CharField(max_length=255)
    location = models.CharField(max_length=255, default='', blank=True)
    type = models.CharField(max_length=100, default='Full-time')
    salary = models.CharField(max_length=255, default='', blank=True)
    applicants = models.IntegerField(default=0)
    color = models.CharField(max_length=40, default='blue')
    description = models.TextField(null=True, blank=True)
    openings = models.IntegerField(default=1)
    is_remote = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'job_posts'
        ordering = ['id']


class InterviewLink(models.Model):
    name = models.CharField(max_length=255)
    initials = models.CharField(max_length=10)
    role = models.CharField(max_length=255)
    email = models.CharField(max_length=255)
    phone = models.CharField(max_length=40, default='', blank=True)
    score = models.IntegerField(default=0)
    status = models.CharField(max_length=40, default='Pending')
    interview_date = models.CharField(max_length=60, null=True, blank=True)
    interview_time = models.CharField(max_length=30, null=True, blank=True)
    platform = models.CharField(max_length=100, null=True, blank=True)
    link = models.TextField(null=True, blank=True)
    outcome = models.CharField(max_length=40, null=True, blank=True)
    email_sent = models.BooleanField(default=False)
    interview_type = models.CharField(max_length=100, default='Technical')
    interviewer = models.CharField(max_length=255, default='', blank=True)
    duration = models.CharField(max_length=50, default='45 min')
    notes = models.TextField(null=True, blank=True)
    # Stored as a JSON string (matches the original server's JSON.stringify).
    interview_questions = models.TextField(null=True, blank=True)
    # Separate access tokens for candidate and recruiter (with configurable expiry)
    candidate_token = models.CharField(max_length=128, null=True, blank=True, db_index=True)
    recruiter_token = models.CharField(max_length=128, null=True, blank=True, db_index=True)
    link_expires_at = models.DateTimeField(null=True, blank=True)
    # Resume and JD text stored for AI-enhanced question generation
    resume_text = models.TextField(null=True, blank=True)
    jd_text = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'interview_links'
        ordering = ['id']


class ResumeScore(models.Model):
    name = models.CharField(max_length=255)
    initials = models.CharField(max_length=10)
    role = models.CharField(max_length=255)
    score = models.IntegerField(default=0)
    technical = models.IntegerField(default=0)
    experience = models.IntegerField(default=0)
    domain = models.IntegerField(default=0)
    gap = models.TextField(null=True, blank=True)
    skills = models.JSONField(null=True, blank=True)
    missing = models.JSONField(null=True, blank=True)
    source = models.CharField(max_length=100, default='Upload')
    formatted = models.BooleanField(default=False)
    uploaded = models.BooleanField(default=True)
    file_name = models.CharField(max_length=255, null=True, blank=True)
    resume_text = models.TextField(null=True, blank=True)
    jd_text = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'resume_scores'
        ordering = ['id']


class InterviewRecording(models.Model):
    candidate_name = models.CharField(max_length=255)
    candidate_email = models.CharField(max_length=255, default='', blank=True)
    role = models.CharField(max_length=255, default='', blank=True)
    duration = models.IntegerField(default=0)
    verdict = models.CharField(max_length=20, default='HOLD')
    total_score = models.IntegerField(default=0)
    tech_score = models.IntegerField(default=0)
    comm_score = models.IntegerField(default=0)
    integrity_score = models.IntegerField(default=0)
    recording_data = models.TextField(null=True, blank=True)   # base64 video
    video_buffer = models.BinaryField(null=True, blank=True)   # raw LONGBLOB
    video_mime = models.CharField(max_length=100, null=True, blank=True)
    transcript = models.TextField(null=True, blank=True)
    responses = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'interview_recordings'
        ordering = ['id']


class QuestionSet(models.Model):
    id = models.CharField(max_length=40, primary_key=True)
    questions = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'question_sets'


class AppUser(models.Model):
    """Login accounts created in Settings -> User Access (and via Sign-up).
    Maps onto the existing `app_users` table so every login persists in MySQL
    instead of only the browser's localStorage. `password` is plain text to
    match the admin UI's "SHOW" reveal button (see hrms_system_schema.sql)."""
    full_name = models.CharField(max_length=255)
    email = models.CharField(max_length=255, unique=True)
    password = models.CharField(max_length=255, default='', blank=True)
    initials = models.CharField(max_length=10, default='', blank=True)
    role = models.CharField(max_length=40, default='admin')      # admin | recruitment | hr
    status = models.CharField(max_length=20, default='active')   # active | disabled
    # Social / Google login fields
    auth_provider = models.CharField(max_length=20, default='email')  # email | google
    google_id = models.CharField(max_length=128, null=True, blank=True, unique=True)
    profile_pic = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'app_users'
        ordering = ['id']


class UserProfile(models.Model):
    email = models.CharField(max_length=255, primary_key=True)
    first_name = models.CharField(max_length=120, default='', blank=True)
    last_name = models.CharField(max_length=120, default='', blank=True)
    phone = models.CharField(max_length=40, default='', blank=True)
    alt_email = models.CharField(max_length=255, default='', blank=True)
    blood_group = models.CharField(max_length=10, default='', blank=True)
    department = models.CharField(max_length=120, default='', blank=True)
    designation = models.CharField(max_length=120, default='', blank=True)
    address = models.TextField(null=True, blank=True)
    profile_pic = models.TextField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'user_profiles'


class UserEmailConfig(models.Model):
    user_email = models.CharField(max_length=255, primary_key=True)
    smtp_host = models.CharField(max_length=255, default='', blank=True)
    smtp_port = models.CharField(max_length=10, default='', blank=True)
    smtp_user = models.CharField(max_length=255, default='', blank=True)
    smtp_password = models.CharField(max_length=255, default='', blank=True)
    smtp_secure = models.BooleanField(default=False)
    from_name = models.CharField(max_length=255, default='', blank=True)
    from_email = models.CharField(max_length=255, default='', blank=True)
    social = models.JSONField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'user_email_config'


class UserDocument(models.Model):
    user_email = models.CharField(max_length=255)
    doc_type = models.CharField(max_length=60)
    file_name = models.CharField(max_length=255, default='', blank=True)
    file_mime = models.CharField(max_length=100, default='', blank=True)
    file_data = models.TextField(null=True, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'user_documents'
        unique_together = (('user_email', 'doc_type'),)


class LoginOtp(models.Model):
    """One-time login codes for two-step (OTP) authentication. The 6-digit code
    is stored salted+hashed, never in plain text."""
    email = models.CharField(max_length=255, db_index=True)
    code_hash = models.CharField(max_length=128)
    salt = models.CharField(max_length=32)
    attempts = models.IntegerField(default=0)
    consumed = models.BooleanField(default=False)
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'login_otps'
        ordering = ['-id']


class PasswordReset(models.Model):
    """Single-use, time-limited tokens for the Forgot Password flow."""
    email = models.CharField(max_length=255, db_index=True)
    token = models.CharField(max_length=128, unique=True)
    used_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'password_resets'
        ordering = ['-id']


class LiveSession(models.Model):
    """REST-based WebRTC signaling for recruiter live-viewing of an F2F
    interview. The candidate (publisher) posts an SDP offer + ICE candidates;
    the recruiter (viewer) posts an SDP answer + ICE candidates. Both sides
    poll this row to complete the peer-to-peer connection."""
    session_id = models.CharField(max_length=64, unique=True)
    candidate_name = models.CharField(max_length=255, default='', blank=True)
    role = models.CharField(max_length=255, default='', blank=True)
    interview_id = models.IntegerField(null=True, blank=True)
    status = models.CharField(max_length=20, default='waiting')  # waiting|live|ended
    offer = models.TextField(null=True, blank=True)               # candidate SDP offer (JSON)
    answer = models.TextField(null=True, blank=True)              # recruiter SDP answer (JSON)
    candidate_ice = models.JSONField(default=list, blank=True)    # ICE from candidate
    recruiter_ice = models.JSONField(default=list, blank=True)    # ICE from recruiter
    transcript = models.TextField(null=True, blank=True)          # live transcript snapshot
    current_question = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'live_sessions'
        ordering = ['-id']


# ===========================================================================
# Employees module
# Attendance / Check-In-Out · Leave · Tasks · Work Submissions.
# Employees are identified by their login email (app_users / user_profiles);
# there is no separate roster table.
# ===========================================================================
class EmployeeAttendance(models.Model):
    """One row per employee per day. Check-in stamps ``check_in`` (and the
    device it came from); check-out stamps ``check_out`` and computes
    ``worked_minutes``. ``status`` is derived on check-in (present/late)."""
    email = models.CharField(max_length=255, db_index=True)
    employee_name = models.CharField(max_length=255, default='', blank=True)
    date = models.DateField(db_index=True)
    check_in = models.DateTimeField(null=True, blank=True)
    check_out = models.DateTimeField(null=True, blank=True)
    device = models.CharField(max_length=20, default='', blank=True)   # mobile | desktop
    status = models.CharField(max_length=20, default='present')        # present | late | absent | half-day
    # Live presence chosen from the STATUS picker (Available / Away / Busy /
    # Do not disturb / ...). Empty = fall back to location-derived team status.
    presence = models.CharField(max_length=40, default='', blank=True)
    presence_at = models.DateTimeField(null=True, blank=True)
    worked_minutes = models.IntegerField(default=0)
    note = models.CharField(max_length=255, default='', blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'employee_attendance'
        ordering = ['-date', '-id']
        unique_together = (('email', 'date'),)


class LeaveRequest(models.Model):
    """A leave application with an approval workflow."""
    email = models.CharField(max_length=255, db_index=True)
    employee_name = models.CharField(max_length=255, default='', blank=True)
    type = models.CharField(max_length=60, default='Casual Leave')
    from_date = models.DateField()
    to_date = models.DateField()
    days = models.IntegerField(default=1)
    reason = models.TextField(null=True, blank=True)
    status = models.CharField(max_length=20, default='Pending')   # Pending | Approved | Rejected
    approver = models.CharField(max_length=255, default='', blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'leave_requests'
        ordering = ['-id']


class EmployeeTask(models.Model):
    """A task on the Task Tracker board."""
    title = models.CharField(max_length=255)
    assignee = models.CharField(max_length=255, default='', blank=True)
    assignee_email = models.CharField(max_length=255, default='', blank=True)
    due = models.CharField(max_length=60, default='', blank=True)   # date string as the UI sends it
    priority = models.CharField(max_length=20, default='medium')    # low | medium | high
    stage = models.CharField(max_length=20, default='todo')         # todo | inprogress | done
    description = models.TextField(null=True, blank=True)
    created_by = models.CharField(max_length=255, default='', blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'employee_tasks'
        ordering = ['-id']


class WorkSubmission(models.Model):
    """A work item / deliverable submitted by an employee for review."""
    email = models.CharField(max_length=255, db_index=True)
    employee_name = models.CharField(max_length=255, default='', blank=True)
    title = models.CharField(max_length=255)
    type = models.CharField(max_length=60, default='Document', blank=True)
    date = models.DateField(null=True, blank=True)
    summary = models.TextField(null=True, blank=True)
    link = models.CharField(max_length=500, default='', blank=True)
    file_name = models.CharField(max_length=255, default='', blank=True)
    status = models.CharField(max_length=20, default='Pending')   # Pending | In Review | Approved | Rejected
    reviewer = models.CharField(max_length=255, default='', blank=True)
    ai_score = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'work_submissions'
        ordering = ['-id']


class AttendanceEvent(models.Model):
    """A single timeline event on an employee's day — check-in / check-out,
    break start / end, or a work-mode switch (office <-> remote). These rows
    drive the "Today's Activity Log" panel (per employee) and the
    "Team Status Now" panel (latest event per employee → live status)."""
    # check-in | check-out | break-start | break-end | remote-switch | office-switch
    email = models.CharField(max_length=255, db_index=True)
    employee_name = models.CharField(max_length=255, default='', blank=True)
    date = models.DateField(db_index=True)
    event = models.CharField(max_length=30)
    location = models.CharField(max_length=120, default='', blank=True)
    at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'attendance_events'
        ordering = ['at', 'id']
