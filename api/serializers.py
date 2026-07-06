"""
Django REST Framework serializers for the HRMS API.

Every serializer reproduces the exact camelCase JSON contract the React
frontend depends on (previously emitted by the hand-written ``*_dict`` mappers
in ``views.py``). Field names are camelCase and mapped onto the snake_case
model columns via ``source=``; representation-only coercions (null -> '',
JSON-string parsing, int casting) are handled in ``to_representation`` so the
output is byte-for-byte compatible with the original Node/Express API.

These serializers are self-contained (no import from ``views``) to avoid a
circular import, since ``views`` imports from here.
"""
import json
import os

from rest_framework import serializers

from .models import (
    AppUser,
    AttendanceEvent,
    Company,
    EmployeeAttendance,
    EmployeeTask,
    Module,
    Notification,
    Permission,
    PermissionGroup,
    Role,
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

# Datetime wire format used everywhere by the original API (naive, USE_TZ=False).
DATETIME_FMT = '%Y-%m-%d %H:%M:%S'


# ---------------------------------------------------------------------------
# Pure helpers (mirror the ones in views.py — kept local to avoid a circular
# import between views and serializers).
# ---------------------------------------------------------------------------
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


def make_initials(name):
    import re
    parts = [p for p in re.split(r'\s+', (name or '').strip()) if p]
    return ''.join(p[0] for p in parts).upper()[:2]


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
# Custom fields
# ---------------------------------------------------------------------------
class JSONStringField(serializers.Field):
    """A TextField column that stores a JSON-encoded value.

    Reads it back into a native Python object (returns ``None`` when the column
    is empty or not valid JSON); writes by ``json.dumps`` (``None`` when the
    incoming value is falsy), matching the original ``json.dumps``/``safe_json``
    behaviour for ``interview_questions``.
    """
    def to_representation(self, value):
        return safe_json(value)

    def to_internal_value(self, data):
        if not data:
            return None
        return json.dumps(data)


class InterviewTypeField(serializers.Field):
    """``interview_type`` column that the frontend treats as a list of strings.

    The React app always reads ``interviewType`` as an array (``.includes``,
    ``.join``, checkbox toggles) and sends it as an array on create. Storing it
    in the ``CharField`` column as a JSON-encoded list keeps that contract
    intact while remaining tolerant of legacy rows that hold a plain string
    (``"Technical"``) or a Python-repr list (``"['Technical']"``).
    """
    def to_representation(self, value):
        if value is None or value == '':
            return ['Technical']
        if isinstance(value, list):
            return value
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
                if isinstance(parsed, list):
                    return parsed
            except ValueError:
                pass
            try:
                import ast
                parsed = ast.literal_eval(value)
                if isinstance(parsed, list):
                    return [str(v) for v in parsed]
            except (ValueError, SyntaxError):
                pass
            return [v.strip() for v in value.split(',') if v.strip()] or ['Technical']
        return [str(value)]

    def to_internal_value(self, data):
        if data is None or data == '':
            return 'Technical'
        if isinstance(data, list):
            return json.dumps([str(v) for v in data])
        return str(data)


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------
class NotificationSerializer(serializers.ModelSerializer):
    notificationType = serializers.CharField(source='notification_type')
    isRead = serializers.BooleanField(source='is_read')
    createdAt = serializers.DateTimeField(source='created_at', read_only=True)

    class Meta:
        model = Notification
        fields = ['id', 'recipient', 'title', 'message', 'notificationType', 'isRead', 'link', 'createdAt']


class JobPostSerializer(serializers.ModelSerializer):
    remote = serializers.BooleanField(source='is_remote', required=False, default=False)
    description = serializers.CharField(
        required=False, allow_blank=True, allow_null=True, default='',
    )

    class Meta:
        model = JobPost
        fields = [
            'id', 'title', 'dept', 'location', 'type', 'salary', 'applicants',
            'color', 'description', 'openings', 'remote',
        ]
        read_only_fields = ['id', 'applicants', 'color']
        extra_kwargs = {
            'location': {'required': False, 'default': ''},
            'type': {'required': False, 'default': 'Full-time'},
            'salary': {'required': False, 'default': ''},
            'openings': {'required': False, 'default': 1},
        }

    def to_representation(self, instance):
        return {
            'id': instance.id,
            'title': instance.title,
            'dept': instance.dept,
            'location': instance.location,
            'type': instance.type,
            'salary': instance.salary,
            'applicants': instance.applicants,
            'color': instance.color,
            'description': instance.description or '',
            'openings': instance.openings,
            'remote': bool(instance.is_remote),
        }

    def create(self, validated_data):
        openings = to_int(validated_data.get('openings', 1), 1)
        validated_data['openings'] = openings if openings > 0 else 1
        validated_data['color'] = resolve_color(validated_data.get('type', 'Full-time'))
        validated_data['applicants'] = 0
        return super().create(validated_data)


# ---------------------------------------------------------------------------
# Interviews
# ---------------------------------------------------------------------------
class InterviewLinkSerializer(serializers.ModelSerializer):
    interviewDate = serializers.CharField(source='interview_date', required=False, allow_null=True, allow_blank=True)
    time = serializers.CharField(source='interview_time', required=False, allow_null=True, allow_blank=True)
    emailSent = serializers.BooleanField(source='email_sent', required=False, default=False)
    interviewType = InterviewTypeField(source='interview_type', required=False)
    interviewQuestions = JSONStringField(source='interview_questions', required=False)
    resumeText = serializers.CharField(source='resume_text', required=False, allow_blank=True, allow_null=True)
    jdText = serializers.CharField(source='jd_text', required=False, allow_blank=True, allow_null=True)

    class Meta:
        model = InterviewLink
        fields = [
            'id', 'name', 'initials', 'role', 'email', 'phone', 'score', 'status',
            'interviewDate', 'time', 'platform', 'link', 'outcome', 'emailSent',
            'interviewType', 'interviewer', 'duration', 'notes',
            'interviewQuestions', 'resumeText', 'jdText',
        ]
        read_only_fields = ['id']
        extra_kwargs = {
            'phone': {'required': False, 'allow_blank': True, 'default': ''},
            'score': {'required': False, 'default': 0},
            'status': {'required': False, 'default': 'Scheduled'},
            'platform': {'required': False, 'allow_null': True},
            'link': {'required': False, 'allow_null': True},
            'outcome': {'required': False, 'allow_null': True},
            'interviewer': {'required': False, 'allow_blank': True, 'default': ''},
            'duration': {'required': False, 'default': '45 min'},
            'notes': {'required': False, 'allow_null': True, 'allow_blank': True},
            'initials': {'required': False, 'allow_blank': True},
        }

    def to_representation(self, instance):
        return {
            'id': instance.id,
            'name': instance.name,
            'initials': instance.initials,
            'role': instance.role,
            'email': instance.email,
            'phone': instance.phone,
            'score': instance.score,
            'status': instance.status,
            'interviewDate': instance.interview_date,
            'time': instance.interview_time,
            'platform': instance.platform,
            'link': instance.link,
            'outcome': instance.outcome,
            'emailSent': bool(instance.email_sent),
            'interviewType': InterviewTypeField().to_representation(instance.interview_type),
            'interviewer': instance.interviewer,
            'duration': instance.duration,
            'notes': instance.notes,
            'interviewQuestions': safe_json(instance.interview_questions),
            'candidateToken': instance.candidate_token or '',
            'recruiterToken': instance.recruiter_token or '',
            'linkExpiresAt': instance.link_expires_at.strftime(DATETIME_FMT) if instance.link_expires_at else None,
            'resumeText': instance.resume_text or '',
            'jdText': instance.jd_text or '',
            'createdAt': instance.created_at.strftime(DATETIME_FMT) if instance.created_at else None,
        }

    def create(self, validated_data):
        if not validated_data.get('initials'):
            validated_data['initials'] = make_initials(validated_data.get('name'))
        validated_data.setdefault('platform', 'Microsoft Teams')
        return super().create(validated_data)


# ---------------------------------------------------------------------------
# Resume Scores
# ---------------------------------------------------------------------------
class ResumeScoreSerializer(serializers.ModelSerializer):
    fileName = serializers.CharField(source='file_name', required=False, allow_null=True, allow_blank=True)
    fileMime = serializers.CharField(write_only=True, required=False, allow_null=True, allow_blank=True)
    fileData = serializers.CharField(write_only=True, required=False, allow_null=True, allow_blank=True)
    resumeText = serializers.CharField(source='resume_text', required=False, allow_blank=True, allow_null=True)
    jdText = serializers.CharField(source='jd_text', required=False, allow_blank=True, allow_null=True)

    class Meta:
        model = ResumeScore
        fields = [
            'id', 'name', 'initials', 'role', 'score', 'technical', 'experience',
            'domain', 'gap', 'skills', 'missing', 'formatted', 'source',
            'uploaded', 'fileName', 'fileMime', 'fileData', 'resumeText', 'jdText',
        ]
        read_only_fields = ['id']
        extra_kwargs = {
            'initials': {'required': False, 'allow_blank': True},
            'role': {'required': False, 'default': 'Software Professional'},
            'score': {'required': False, 'default': 0},
            'technical': {'required': False, 'default': 0},
            'experience': {'required': False, 'default': 0},
            'domain': {'required': False, 'default': 0},
            'gap': {'required': False, 'allow_blank': True, 'allow_null': True, 'default': ''},
            'skills': {'required': False},
            'missing': {'required': False},
            'source': {'required': False, 'default': 'Upload'},
            'formatted': {'required': False, 'default': False},
            'uploaded': {'required': False, 'default': True},
        }

    def to_representation(self, instance):
        return {
            'id': instance.id,
            'name': instance.name,
            'initials': instance.initials,
            'role': instance.role,
            'score': to_int(instance.score),
            'technical': to_int(instance.technical),
            'experience': to_int(instance.experience),
            'domain': to_int(instance.domain),
            'gap': instance.gap,
            'skills': safe_list(instance.skills),
            'missing': safe_list(instance.missing),
            'formatted': bool(instance.formatted),
            'source': instance.source or 'Upload',
            'uploaded': bool(instance.uploaded),
            'fileName': instance.file_name,
            'resumeText': instance.resume_text,
            'jdText': instance.jd_text,
        }

    def create(self, validated_data):
        # Accept file uploads in resume scoring payloads without requiring a
        # separate document model for the same request shape.
        validated_data.pop('fileMime', None)
        file_data = validated_data.pop('fileData', None)
        if not validated_data.get('name') and validated_data.get('file_name'):
            validated_data['name'] = os.path.splitext(validated_data['file_name'])[0]
        if file_data and not validated_data.get('resume_text'):
            validated_data['resume_text'] = ''
        if not validated_data.get('initials'):
            validated_data['initials'] = make_initials(validated_data.get('name'))
        skills = validated_data.get('skills')
        missing = validated_data.get('missing')
        validated_data['skills'] = skills if isinstance(skills, list) else []
        validated_data['missing'] = missing if isinstance(missing, list) else []
        return super().create(validated_data)


# ---------------------------------------------------------------------------
# Interview Recordings
# ---------------------------------------------------------------------------
class InterviewRecordingSerializer(serializers.ModelSerializer):
    """Recording metadata (the list/create shape). The heavy ``recording_data``
    base64 blob is write-only here; the detail view adds it back explicitly."""
    candidateName = serializers.CharField(source='candidate_name')
    candidateEmail = serializers.CharField(source='candidate_email', required=False, allow_blank=True, default='')
    totalScore = serializers.IntegerField(source='total_score', required=False, default=0)
    techScore = serializers.IntegerField(source='tech_score', required=False, default=0)
    commScore = serializers.IntegerField(source='comm_score', required=False, default=0)
    integrityScore = serializers.IntegerField(source='integrity_score', required=False, default=0)
    recordingData = serializers.CharField(source='recording_data', required=False, allow_null=True, allow_blank=True, write_only=True)

    class Meta:
        model = InterviewRecording
        fields = [
            'id', 'candidateName', 'candidateEmail', 'role', 'duration', 'verdict',
            'totalScore', 'techScore', 'commScore', 'integrityScore',
            'transcript', 'responses', 'recordingData',
        ]
        read_only_fields = ['id']
        extra_kwargs = {
            'role': {'required': False, 'allow_blank': True, 'default': ''},
            'duration': {'required': False, 'default': 0},
            'verdict': {'required': False, 'default': 'HOLD'},
            'transcript': {'required': False, 'allow_blank': True, 'allow_null': True, 'default': ''},
            'responses': {'required': False},
        }

    def to_representation(self, instance):
        # ``_has_video`` / ``_has_recording`` are annotated by the list queryset
        # (which defers the heavy columns); fall back to the columns otherwise.
        return {
            'id': instance.id,
            'candidateName': instance.candidate_name,
            'candidateEmail': instance.candidate_email,
            'role': instance.role,
            'duration': instance.duration,
            'verdict': instance.verdict,
            'totalScore': instance.total_score,
            'techScore': instance.tech_score,
            'commScore': instance.comm_score,
            'integrityScore': instance.integrity_score,
            'hasVideo': bool(getattr(instance, '_has_video', instance.video_buffer)),
            'hasRecording': bool(getattr(instance, '_has_recording', instance.recording_data)),
            'transcript': instance.transcript,
            'responses': safe_list(instance.responses),
            'createdAt': instance.created_at.strftime(DATETIME_FMT) if instance.created_at else None,
        }

    def create(self, validated_data):
        responses = validated_data.get('responses')
        validated_data['responses'] = responses if isinstance(responses, list) else []
        return super().create(validated_data)


# ---------------------------------------------------------------------------
# Question Sets
# ---------------------------------------------------------------------------
class QuestionSetSerializer(serializers.ModelSerializer):
    questions = serializers.JSONField()

    class Meta:
        model = QuestionSet
        fields = ['id', 'questions']
        read_only_fields = ['id']

    def to_representation(self, instance):
        return {'id': instance.id, 'questions': safe_list(instance.questions)}


# ---------------------------------------------------------------------------
# App Users (Settings -> User Access logins)
# ---------------------------------------------------------------------------
class AppUserSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source='full_name')

    class Meta:
        model = AppUser
        fields = ['name', 'email', 'password', 'initials', 'role', 'status']
        extra_kwargs = {
            'initials': {'required': False, 'allow_blank': True},
            'role': {'required': False, 'default': 'admin'},
            'status': {'required': False, 'default': 'active'},
        }

    def to_representation(self, instance):
        # Keys match what the React app (services/usersApi.js + AuthContext) reads.
        return {
            'id': instance.id,
            'name': instance.full_name,
            'email': instance.email,
            'password': instance.password,
            'initials': instance.initials,
            'role': instance.role,
            'status': instance.status,
            'authProvider': instance.auth_provider,
            'profilePic': instance.profile_pic or '',
            'createdAt': instance.created_at.strftime(DATETIME_FMT) if instance.created_at else None,
        }

    def create(self, validated_data):
        if not validated_data.get('initials'):
            validated_data['initials'] = make_initials(validated_data.get('full_name'))
        return super().create(validated_data)


# ---------------------------------------------------------------------------
# User Settings: Profile / Email config / Documents
# ---------------------------------------------------------------------------
class UserProfileSerializer(serializers.ModelSerializer):
    firstName = serializers.CharField(source='first_name', required=False, allow_blank=True, default='')
    lastName = serializers.CharField(source='last_name', required=False, allow_blank=True, default='')
    altEmail = serializers.CharField(source='alt_email', required=False, allow_blank=True, default='')
    bloodGroup = serializers.CharField(source='blood_group', required=False, allow_blank=True, default='')
    profilePic = serializers.CharField(source='profile_pic', required=False, allow_blank=True, allow_null=True, default='')

    class Meta:
        model = UserProfile
        fields = [
            'email', 'firstName', 'lastName', 'phone', 'altEmail',
            'bloodGroup', 'department', 'designation', 'address', 'profilePic',
        ]
        extra_kwargs = {
            'phone': {'required': False, 'allow_blank': True, 'default': ''},
            'department': {'required': False, 'allow_blank': True, 'default': ''},
            'designation': {'required': False, 'allow_blank': True, 'default': ''},
            'address': {'required': False, 'allow_blank': True, 'allow_null': True, 'default': ''},
        }

    def to_representation(self, instance):
        return {
            'email': instance.email,
            'firstName': instance.first_name or '',
            'lastName': instance.last_name or '',
            'phone': instance.phone or '',
            'altEmail': instance.alt_email or '',
            'bloodGroup': instance.blood_group or '',
            'department': instance.department or '',
            'designation': instance.designation or '',
            'address': instance.address or '',
            'profilePic': instance.profile_pic or '',
            'updatedAt': instance.updated_at.strftime(DATETIME_FMT) if instance.updated_at else None,
        }


class UserEmailConfigSerializer(serializers.ModelSerializer):
    email = serializers.CharField(source='user_email', read_only=True)
    smtpHost = serializers.CharField(source='smtp_host', required=False, allow_blank=True, default='')
    smtpPort = serializers.CharField(source='smtp_port', required=False, allow_blank=True, default='')
    smtpUser = serializers.CharField(source='smtp_user', required=False, allow_blank=True, default='')
    smtpPassword = serializers.CharField(source='smtp_password', required=False, allow_blank=True, default='')
    smtpSecure = serializers.BooleanField(source='smtp_secure', required=False, default=False)
    fromName = serializers.CharField(source='from_name', required=False, allow_blank=True, default='')
    fromEmail = serializers.CharField(source='from_email', required=False, allow_blank=True, default='')
    social = serializers.JSONField(required=False)

    class Meta:
        model = UserEmailConfig
        fields = [
            'email', 'smtpHost', 'smtpPort', 'smtpUser', 'smtpPassword',
            'smtpSecure', 'fromName', 'fromEmail', 'social',
        ]

    def to_representation(self, instance):
        return {
            'email': instance.user_email,
            'smtpHost': instance.smtp_host or '',
            'smtpPort': instance.smtp_port or '',
            'smtpUser': instance.smtp_user or '',
            'smtpPassword': instance.smtp_password or '',
            'smtpSecure': bool(instance.smtp_secure),
            'fromName': instance.from_name or '',
            'fromEmail': instance.from_email or '',
            'social': safe_json(instance.social) or {},
            'updatedAt': instance.updated_at.strftime(DATETIME_FMT) if instance.updated_at else None,
        }


class UserDocumentSerializer(serializers.ModelSerializer):
    docType = serializers.CharField(source='doc_type')
    fileName = serializers.CharField(source='file_name', required=False, allow_blank=True, default='')
    fileMime = serializers.CharField(source='file_mime', required=False, allow_blank=True, default='')
    fileData = serializers.CharField(source='file_data', required=False, allow_null=True, allow_blank=True, write_only=True)

    class Meta:
        model = UserDocument
        fields = ['id', 'docType', 'fileName', 'fileMime', 'fileData']
        read_only_fields = ['id']

    def __init__(self, *args, **kwargs):
        # Pass ``include_data=True`` to also expose the (large) base64 fileData
        # in the output — matches document_dict(..., include_data=True).
        self._include_data = kwargs.pop('include_data', False)
        super().__init__(*args, **kwargs)

    def to_representation(self, instance):
        base = {
            'id': instance.id,
            'docType': instance.doc_type,
            'fileName': instance.file_name or '',
            'fileMime': instance.file_mime or '',
            'uploadedAt': instance.uploaded_at.strftime(DATETIME_FMT) if instance.uploaded_at else None,
        }
        if self._include_data:
            base['fileData'] = instance.file_data or ''
        return base


# ---------------------------------------------------------------------------
# Employees module
# ---------------------------------------------------------------------------
DATE_FMT = '%Y-%m-%d'


class EmployeeAttendanceSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmployeeAttendance
        fields = [
            'id', 'email', 'employee_name', 'date', 'check_in', 'check_out',
            'device', 'status', 'worked_minutes', 'note',
        ]
        read_only_fields = ['id']

    def to_representation(self, instance):
        checked_in = bool(
            instance.check_in
            and (instance.check_out is None or instance.check_in > instance.check_out)
        )
        return {
            'id': instance.id,
            'email': instance.email,
            'employee': instance.employee_name or '',
            'date': instance.date.strftime(DATE_FMT) if instance.date else None,
            'checkIn': instance.check_in.strftime(DATETIME_FMT) if instance.check_in else None,
            'checkOut': instance.check_out.strftime(DATETIME_FMT) if instance.check_out else None,
            'checkInTime': instance.check_in.strftime('%H:%M') if instance.check_in else None,
            'checkOutTime': instance.check_out.strftime('%H:%M') if instance.check_out else None,
            'checkedIn': checked_in,
            'device': instance.device or '',
            'status': instance.status,
            'presence': instance.presence or '',
            'workedMinutes': instance.worked_minutes,
            'note': instance.note or '',
        }


class LeaveRequestSerializer(serializers.ModelSerializer):
    employee = serializers.CharField(source='employee_name', required=False, allow_blank=True, default='')
    fromDate = serializers.DateField(source='from_date')
    toDate = serializers.DateField(source='to_date')

    class Meta:
        model = LeaveRequest
        fields = [
            'id', 'email', 'employee', 'type', 'fromDate', 'toDate',
            'days', 'reason', 'status', 'approver',
        ]
        read_only_fields = ['id']
        extra_kwargs = {
            'type': {'required': False, 'default': 'Casual Leave'},
            'days': {'required': False, 'default': 1},
            'reason': {'required': False, 'allow_blank': True, 'allow_null': True, 'default': ''},
            'status': {'required': False, 'default': 'Pending'},
            'approver': {'required': False, 'allow_blank': True, 'default': ''},
        }

    def to_representation(self, instance):
        return {
            'id': instance.id,
            'email': instance.email,
            'employee': instance.employee_name or '',
            'type': instance.type,
            'fromDate': instance.from_date.strftime(DATE_FMT) if instance.from_date else None,
            'toDate': instance.to_date.strftime(DATE_FMT) if instance.to_date else None,
            'days': instance.days,
            'reason': instance.reason or '',
            'status': instance.status,
            'approver': instance.approver or '',
            'createdAt': instance.created_at.strftime(DATETIME_FMT) if instance.created_at else None,
        }

    def create(self, validated_data):
        # Derive the day count from the date range when the client didn't send it.
        if not validated_data.get('days'):
            fd, td = validated_data.get('from_date'), validated_data.get('to_date')
            validated_data['days'] = max((td - fd).days + 1, 1) if fd and td else 1
        return super().create(validated_data)


class EmployeeTaskSerializer(serializers.ModelSerializer):
    assigneeEmail = serializers.CharField(source='assignee_email', required=False, allow_blank=True, default='')
    createdBy = serializers.CharField(source='created_by', required=False, allow_blank=True, default='')

    class Meta:
        model = EmployeeTask
        fields = [
            'id', 'title', 'assignee', 'assigneeEmail', 'due', 'priority',
            'stage', 'description', 'createdBy',
        ]
        read_only_fields = ['id']
        extra_kwargs = {
            'assignee': {'required': False, 'allow_blank': True, 'default': ''},
            'due': {'required': False, 'allow_blank': True, 'default': ''},
            'priority': {'required': False, 'default': 'medium'},
            'stage': {'required': False, 'default': 'todo'},
            'description': {'required': False, 'allow_blank': True, 'allow_null': True, 'default': ''},
        }

    def to_representation(self, instance):
        return {
            'id': instance.id,
            'title': instance.title,
            'assignee': instance.assignee or '',
            'assigneeEmail': instance.assignee_email or '',
            'due': instance.due or '',
            'priority': instance.priority,
            'stage': instance.stage,
            'description': instance.description or '',
            'createdBy': instance.created_by or '',
            'createdAt': instance.created_at.strftime(DATETIME_FMT) if instance.created_at else None,
        }


class WorkSubmissionSerializer(serializers.ModelSerializer):
    employee = serializers.CharField(source='employee_name', required=False, allow_blank=True, default='')
    fileName = serializers.CharField(source='file_name', required=False, allow_blank=True, default='')
    aiScore = serializers.IntegerField(source='ai_score', required=False, default=0)

    class Meta:
        model = WorkSubmission
        fields = [
            'id', 'email', 'employee', 'title', 'type', 'date', 'summary',
            'link', 'fileName', 'status', 'reviewer', 'aiScore',
        ]
        read_only_fields = ['id']
        extra_kwargs = {
            'type': {'required': False, 'allow_blank': True, 'default': 'Document'},
            'summary': {'required': False, 'allow_blank': True, 'allow_null': True, 'default': ''},
            'link': {'required': False, 'allow_blank': True, 'default': ''},
            'status': {'required': False, 'default': 'Pending'},
            'reviewer': {'required': False, 'allow_blank': True, 'default': ''},
        }

    def to_representation(self, instance):
        return {
            'id': instance.id,
            'email': instance.email,
            'employee': instance.employee_name or '',
            'title': instance.title,
            'type': instance.type or 'Document',
            'date': instance.date.strftime(DATE_FMT) if instance.date else None,
            'submitted': instance.date.strftime(DATE_FMT) if instance.date else (
                instance.created_at.strftime(DATE_FMT) if instance.created_at else ''),
            'summary': instance.summary or '',
            'link': instance.link or '',
            'fileName': instance.file_name or '',
            'status': instance.status,
            'reviewer': instance.reviewer or '',
            'aiScore': instance.ai_score or 0,
            'createdAt': instance.created_at.strftime(DATETIME_FMT) if instance.created_at else None,
        }

    def create(self, validated_data):
        # Stamp the submission date server-side when the client didn't send one.
        if not validated_data.get('date'):
            from datetime import date as _date
            validated_data['date'] = _date.today()
        return super().create(validated_data)


# Display label + dot colour for each activity-log event type. Colours map to
# the React app's CSS vars (--success / --warn / --accent / --danger) so the
# frontend can render the timeline dots without any client-side lookup.
ATTENDANCE_EVENT_LABELS = {
    'check-in': 'Check In',
    'check-out': 'Check Out',
    'break-start': 'Break Start',
    'break-end': 'Break End',
    'remote-switch': 'Remote Switch',
    'office-switch': 'Office Switch',
}
ATTENDANCE_EVENT_COLORS = {
    'check-in': 'success',
    'check-out': 'danger',
    'break-start': 'warn',
    'break-end': 'success',
    'remote-switch': 'accent',
    'office-switch': 'success',
}


class AttendanceEventSerializer(serializers.ModelSerializer):
    """Serialises an activity-log event into exactly the shape the check-in
    page renders: ``{ time, event, location, color }`` plus raw fields."""

    class Meta:
        model = AttendanceEvent
        fields = ['id', 'email', 'employee_name', 'date', 'event', 'location', 'at']
        read_only_fields = ['id']

    def to_representation(self, instance):
        return {
            'id': instance.id,
            'email': instance.email,
            'employee': instance.employee_name or '',
            'type': instance.event,
            'event': ATTENDANCE_EVENT_LABELS.get(instance.event, instance.event),
            'location': instance.location or '—',
            'time': instance.at.strftime('%I:%M %p') if instance.at else '',
            'color': ATTENDANCE_EVENT_COLORS.get(instance.event, 'gray'),
            'at': instance.at.strftime(DATETIME_FMT) if instance.at else None,
        }


# ===========================================================================
# RBAC serializers
# ---------------------------------------------------------------------------
# These read only fields already loaded by the view (annotated counts +
# select_related FKs), so serialising a list never fires a per-row query.
# ===========================================================================
class CompanySerializer(serializers.ModelSerializer):
    class Meta:
        model = Company
        fields = ['id', 'name', 'is_active']

    def to_representation(self, i):
        return {
            'id': i.id, 'name': i.name, 'isActive': i.is_active,
            'createdAt': i.created_at.strftime(DATETIME_FMT) if i.created_at else None,
        }


class ModuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Module
        fields = ['id', 'name', 'icon', 'order', 'is_active']

    def to_representation(self, i):
        return {
            'id': i.id, 'name': i.name, 'icon': i.icon or '',
            'order': i.order, 'isActive': i.is_active,
        }


class RoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = ['id', 'name', 'description', 'is_active']
        extra_kwargs = {
            'description': {'required': False, 'allow_blank': True, 'default': ''},
            'is_active': {'required': False, 'default': True},
        }

    def to_representation(self, i):
        return {
            'id': i.id,
            'name': i.name,
            'description': i.description or '',
            'isActive': i.is_active,
            'status': 'Active' if i.is_active else 'Inactive',
            # ``permission_count`` / ``user_count`` come from the view's annotate();
            # fall back to a query only when unannotated (detail views).
            'permissionCount': getattr(i, 'permission_count', None)
                if getattr(i, 'permission_count', None) is not None
                else i.role_permissions.count(),
            'userCount': getattr(i, 'user_count', 0) or 0,
            'createdBy': (i.created_by.full_name if i.created_by_id and i.created_by else ''),
            'createdAt': i.created_at.strftime(DATETIME_FMT) if i.created_at else None,
        }


class PermissionGroupSerializer(serializers.ModelSerializer):
    module = serializers.PrimaryKeyRelatedField(
        queryset=Module.objects.all(), required=False, allow_null=True)

    class Meta:
        model = PermissionGroup
        fields = ['id', 'name', 'description', 'module', 'is_active']
        extra_kwargs = {
            'description': {'required': False, 'allow_blank': True, 'default': ''},
            'is_active': {'required': False, 'default': True},
        }

    def to_representation(self, i):
        return {
            'id': i.id,
            'name': i.name,
            'description': i.description or '',
            'moduleId': i.module_id,
            'module': (i.module.name if i.module_id and i.module else ''),
            'isActive': i.is_active,
            'permissionCount': getattr(i, 'permission_count', None)
                if getattr(i, 'permission_count', None) is not None
                else i.permissions.count(),
            'createdAt': i.created_at.strftime(DATETIME_FMT) if i.created_at else None,
        }


class PermissionSerializer(serializers.ModelSerializer):
    group = serializers.PrimaryKeyRelatedField(
        queryset=PermissionGroup.objects.all(), required=False, allow_null=True)

    class Meta:
        model = Permission
        fields = ['id', 'name', 'code', 'description', 'group', 'is_active']
        extra_kwargs = {
            'description': {'required': False, 'allow_blank': True, 'default': ''},
            'is_active': {'required': False, 'default': True},
        }

    def to_representation(self, i):
        return {
            'id': i.id,
            'name': i.name,
            'code': i.code,
            'description': i.description or '',
            'isActive': i.is_active,
            'groupId': i.group_id,
            'group': (i.group.name if i.group_id and i.group else ''),
            'module': (i.group.module.name if i.group_id and i.group and i.group.module_id and i.group.module else ''),
        }
