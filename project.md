# HRMS — Project Context for AI Assistants

> **Purpose:** This file gives an AI assistant (Claude, Gemini, etc.) complete, accurate context
> about the HRMS codebase so it can answer questions and make changes without
> requiring repeated re-explanation.

---

## Overview

**Eversoft HRMS** is a full-stack Human Resource Management System.

| Layer | Technology |
|---|---|
| Backend | Django 5.x + Django REST Framework |
| Database | MySQL (`hrms-ai` DB, same schema as the legacy Node/Express server) |
| Frontend | Pre-built React / Vite SPA (served from `../dist/`) |
| Auth | Custom OTP-based login + Google OAuth (no `django.contrib.auth`) |
| AI | Anthropic Claude API (question generation), with offline fallback |
| Email | SMTP or Resend API |
| Static serving | WhiteNoise (serves `dist/` at site root) |

---

## Repository Layout

```
Eversoft_hrms/
├── dist/                         # Built React/Vite SPA (do NOT edit manually)
│   ├── index.html
│   ├── assets/
│   │   ├── index-DCh6bk0Rv4.js  # Main React bundle (current)
│   │   ├── hrms-live.js          # WebRTC publisher + recruiter monitor
│   │   ├── hrms-rbac.js          # RBAC frontend logic
│   │   ├── hrms-perms.js         # Permissions frontend logic
│   │   ├── hrms-actor.js         # Actor/user utilities
│   │   ├── hrms-attendance.js    # Attendance frontend
│   │   ├── hrms-checkin.js       # Check-in/out frontend
│   │   ├── hrms-notifications.js # Notifications frontend
│   │   ├── hrms-status.js        # Status frontend
│   │   ├── google-auth.js        # Google OAuth frontend
│   │   └── interview-access.js   # Candidate interview access
│   └── favicon.svg / logo.jpg
│
└── hrms_django/                  # Django project root (main backend)
    ├── manage.py
    ├── requirements.txt
    ├── .env.development          # Dev environment variables
    ├── .env.production           # Prod environment variables
    ├── smoke.py                  # End-to-end smoke tests (SQLite, SMTP mocked)
    ├── IMPLEMENTATION_NOTES.md   # Feature implementation notes
    ├── hrms_project/             # Django project package
    │   ├── settings.py           # All Django settings
    │   ├── urls.py               # Root URL conf (api/ + SPA catch-all)
    │   ├── wsgi.py
    │   └── asgi.py
    └── api/                      # Single Django app
        ├── models.py             # All DB models (see Models section)
        ├── views.py              # All main API views (~83 KB)
        ├── auth_views.py         # Auth endpoints (OTP, Google OAuth, pw reset)
        ├── live_views.py         # WebRTC signaling endpoints
        ├── permissions.py        # RBAC enforcement decorators
        ├── serializers.py        # DRF serializers for all models
        ├── ai.py                 # Anthropic Claude integration + offline fallback
        ├── mailer.py             # SMTP/Resend email sending
        ├── social_poster.py      # LinkedIn + X/Twitter auto-posting
        ├── urls.py               # All API URL patterns
        ├── apps.py
        └── management/commands/
            ├── seed_rbac.py      # Seeds default Modules/Roles/Permissions
            ├── seed_data.py      # Seeds demo data
            ├── cleanup_demo_data.py  # Removes demo data
            └── list_notifications.py
```

---

## Django Settings Summary (`hrms_project/settings.py`)

- **No `django.contrib.auth`** — auth is entirely custom via `app_users` table.
- `INSTALLED_APPS`: `corsheaders`, `django.contrib.staticfiles`, `rest_framework`, `api`
- `APPEND_SLASH = False` — no trailing slashes on API paths
- `USE_TZ = False` — naive datetimes (matches legacy Node server)
- `DEFAULT_AUTO_FIELD = 'django.db.models.AutoField'` — INT not BIGINT PKs
- CORS is open in DEBUG, locked in production
- Custom headers allowed: `x-api-key`, `x-user-email`, `x-actor-email`
- DRF has **no authentication classes** and `AllowAny` permission — auth is handled manually in views
- The React build at `../dist/` is served via **WhiteNoise** from the site root
- SPA catch-all: any non-`/api/` route renders `dist/index.html`

### Environment Variables (`.env.development` / `.env.production`)

| Variable | Description |
|---|---|
| `DJANGO_SECRET_KEY` | Django secret key |
| `DJANGO_DEBUG` | `true` / `false` |
| `DJANGO_ALLOWED_HOSTS` | Comma-separated hostnames |
| `DB_NAME` / `DB_USER` / `DB_PASSWORD` / `DB_HOST` / `DB_PORT` | MySQL connection |
| `ANTHROPIC_API_KEY` | Claude API key (AI question generation) |
| `ANTHROPIC_MODEL` | Override generation model (default: `claude-sonnet-4-5`) |
| `ANTHROPIC_VALIDATION_MODEL` | Override validation model (default: `claude-haiku-4-5`) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM_EMAIL` | Global SMTP fallback |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` / `RESEND_FROM_NAME` | Resend email API (preferred over SMTP) |
| `REACT_BUILD_DIR` | Override path to `dist/` (default: `../dist`) |

---

## Database Models (`api/models.py`)

All models map 1:1 onto existing MySQL tables. Table/column names match the original Node server schema exactly.

### Recruitment

| Model | Table | Key Fields |
|---|---|---|
| `JobPost` | `job_posts` | `title`, `dept`, `location`, `type`, `salary`, `openings`, `is_remote`, `applicants` |
| `InterviewLink` | `interview_links` | `name`, `email`, `role`, `status`, `score`, `candidate_token`, `recruiter_token`, `link_expires_at`, `resume_text`, `jd_text`, `interview_questions` (JSON string) |
| `ResumeScore` | `resume_scores` | `name`, `role`, `score`, `technical`, `experience`, `domain`, `skills` (JSON), `missing` (JSON), `resume_text`, `jd_text` |
| `InterviewRecording` | `interview_recordings` | `candidate_name`, `role`, `verdict`, `total_score`, `tech_score`, `comm_score`, `integrity_score`, `recording_data` (base64), `video_buffer` (LONGBLOB), `transcript`, `responses` (JSON) |
| `QuestionSet` | `question_sets` | `id` (string PK), `questions` (JSON) |

### Users & Auth

| Model | Table | Key Fields |
|---|---|---|
| `AppUser` | `app_users` | `full_name`, `email` (unique), `password` (plain text), `role` (legacy: `admin`/`hr`/`recruitment`), `status` (`active`/`disabled`), `role_ref` (FK→Role), `company` (FK→Company), `auth_provider` (`email`/`google`), `google_id`, `profile_pic` |
| `UserProfile` | `user_profiles` | `email` (PK), `first_name`, `last_name`, `phone`, `department`, `designation`, `blood_group`, `address`, `profile_pic` |
| `UserEmailConfig` | `user_email_config` | `user_email` (PK), `smtp_host/port/user/password/secure`, `from_name`, `from_email`, `social` (JSON: LinkedIn + Twitter tokens) |
| `UserDocument` | `user_documents` | `user_email`, `doc_type`, `file_name`, `file_mime`, `file_data` (base64) |
| `LoginOtp` | `login_otps` | `email`, `code_hash` (SHA-256), `salt`, `attempts`, `consumed`, `expires_at` |
| `PasswordReset` | `password_resets` | `email`, `token` (unique), `used_at`, `expires_at` |

### Employees Module

| Model | Table | Key Fields |
|---|---|---|
| `EmployeeAttendance` | `employee_attendance` | `email`, `date` (unique together), `check_in`, `check_out`, `device` (`mobile`/`desktop`), `status` (`present`/`late`/`absent`/`half-day`), `presence`, `worked_minutes` |
| `AttendanceEvent` | `attendance_events` | `email`, `date`, `event` (`check-in`/`check-out`/`break-start`/`break-end`/`remote-switch`/`office-switch`), `location`, `at` |
| `LeaveRequest` | `leave_requests` | `email`, `type`, `from_date`, `to_date`, `days`, `reason`, `status` (`Pending`/`Approved`/`Rejected`), `approver` |
| `EmployeeTask` | `employee_tasks` | `title`, `assignee`, `assignee_email`, `due`, `priority` (`low`/`medium`/`high`), `stage` (`todo`/`inprogress`/`done`) |
| `WorkSubmission` | `work_submissions` | `email`, `title`, `type`, `date`, `summary`, `link`, `file_name`, `status` (`Pending`/`In Review`/`Approved`/`Rejected`), `reviewer`, `ai_score` |

### Notifications

| Model | Table | Key Fields |
|---|---|---|
| `Notification` | `notifications` | `recipient` (email), `title`, `message`, `notification_type`, `is_read`, `link` |

### WebRTC Live Sessions

| Model | Table | Key Fields |
|---|---|---|
| `LiveSession` | `live_sessions` | `session_id` (unique), `candidate_name`, `role`, `interview_id`, `status` (`waiting`/`live`/`ended`), `offer` (SDP JSON), `answer` (SDP JSON), `candidate_ice` (JSON), `recruiter_ice` (JSON), `transcript`, `current_question` |

### RBAC Models

| Model | Table | Key Fields |
|---|---|---|
| `Company` | `companies` | `name` (unique), `is_active` |
| `Module` | `modules` | `name` (unique), `icon`, `order`, `is_active` |
| `Role` | `roles` | `name` (unique), `description`, `is_active`, `created_by` (FK→AppUser) |
| `PermissionGroup` | `permission_groups` | `name` (unique), `description`, `module` (FK→Module), `is_active` |
| `Permission` | `permissions` | `name`, `code` (unique), `description`, `is_active`, `group` (FK→PermissionGroup) |
| `RolePermission` | `role_permissions` | `role` (FK), `permission` (FK) — unique together |

---

## API Routes (`/api/...`)

All routes are under the `/api/` prefix. **No trailing slashes.**

### Authentication (`api/auth_views.py`)
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/login` | Email+password login → sends OTP |
| POST | `/api/auth/verify-otp` | Verify OTP → grants dashboard access |
| POST | `/api/auth/resend-otp` | Resend OTP code |
| POST | `/api/auth/forgot-password` | Send password reset email |
| POST | `/api/auth/reset-password` | Reset password with token |
| GET | `/api/auth/verify-reset-token` | Validate reset token |
| POST | `/api/auth/google` | Google OAuth login |

### Recruitment (`api/views.py`)
| Method | Endpoint | Description |
|---|---|---|
| GET/POST | `/api/jobs` | List / create job posts |
| GET/POST | `/api/interviews` | List / create interview links |
| POST | `/api/interviews/bulk/send-emails` | Bulk send invitation emails |
| POST | `/api/interviews/send-followup` | Send follow-up email |
| GET | `/api/interviews/verify-token` | Validate candidate/recruiter token |
| GET/PUT/PATCH/DELETE | `/api/interviews/<pk>` | Interview detail |
| POST | `/api/interviews/<pk>/regenerate-link` | Regenerate access tokens |
| POST | `/api/interviews/<pk>/resend-invitation` | Resend invitation email |
| GET/POST | `/api/resume-scores` | Resume score list / create |
| GET/POST | `/api/interview-recordings` | Recording list / upload |
| GET/DELETE | `/api/interview-recordings/<pk>` | Recording detail |
| GET | `/api/interview-recordings/<pk>/video` | Stream recording video |
| GET/POST | `/api/question-sets` | Question set list / create |
| GET/PUT/DELETE | `/api/question-sets/<set_id>` | Question set detail |

### AI
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/ai/status` | Check if Anthropic API key is valid |
| POST | `/api/ai/generate-questions` | Generate interview questions (AI or local fallback) |

### Users & Settings
| Method | Endpoint | Description |
|---|---|---|
| GET/POST | `/api/users` | List / create users |
| GET/PUT/DELETE | `/api/users/<email>` | User detail |
| GET/PUT/PATCH | `/api/user-settings/<email>` | User settings |
| GET/PUT/PATCH | `/api/user-settings/<email>/profile` | User profile |
| GET/PUT/PATCH | `/api/user-settings/<email>/email-config` | Email config (SMTP/social) |
| GET/POST | `/api/user-settings/<email>/documents` | Documents list / upload |
| GET/DELETE | `/api/user-settings/<email>/documents/<doc_type>` | Document detail |

### Notifications
| Method | Endpoint | Description |
|---|---|---|
| GET/POST | `/api/notifications` | List / create notifications |
| POST | `/api/notifications/<pk>/read` | Mark as read |
| DELETE | `/api/notifications/<pk>` | Delete notification |
| POST | `/api/notifications/delete` | Batch delete |
| POST | `/api/notifications/read-all` | Mark all as read |

### Employees — Attendance
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/attendance` | List attendance records |
| POST | `/api/attendance/check-in` | Record check-in |
| POST | `/api/attendance/check-out` | Record check-out |
| GET | `/api/attendance/today` | Today's attendance for current user |
| GET/POST | `/api/attendance/events` | Attendance event log |
| GET | `/api/attendance/team` | Team attendance status |
| GET/POST | `/api/attendance/presence` | Presence/status updates |
| GET/PUT/DELETE | `/api/attendance/<pk>` | Attendance record detail |

### Employees — Leave
| Method | Endpoint | Description |
|---|---|---|
| GET/POST | `/api/leave` | List / create leave requests |
| GET | `/api/leave/balance` | Leave balance for a user |
| GET/PUT/DELETE | `/api/leave/<pk>` | Leave request detail |

### Employees — Tasks
| Method | Endpoint | Description |
|---|---|---|
| GET/POST | `/api/tasks` | List / create tasks |
| GET/PUT/DELETE | `/api/tasks/<pk>` | Task detail |

### Employees — Work Submissions
| Method | Endpoint | Description |
|---|---|---|
| GET/POST | `/api/submissions` | List / create work submissions |
| GET/PUT/DELETE | `/api/submissions/<pk>` | Submission detail |

### RBAC
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/rbac/stats` | RBAC dashboard stats |
| GET | `/api/rbac/users` | All users with RBAC roles |
| GET/PUT | `/api/rbac/users/<pk>` | RBAC user detail (assign role) |
| GET/POST | `/api/roles` | List / create roles |
| GET/PUT/DELETE | `/api/roles/<pk>` | Role detail |
| GET/PUT | `/api/roles/<pk>/groups` | Assign permission groups to role |
| GET/PUT | `/api/roles/<pk>/permissions` | View / assign permissions to role |
| GET/POST | `/api/permission-groups` | List / create permission groups |
| GET/PUT/DELETE | `/api/permission-groups/<pk>` | Permission group detail |
| GET/PUT | `/api/permission-groups/<pk>/permissions` | Permissions in a group |
| GET/POST | `/api/permissions` | List / create permissions |
| GET/PUT/DELETE | `/api/permissions/<pk>` | Permission detail |
| GET | `/api/modules` | List modules |
| GET/POST | `/api/companies` | List / create companies |
| GET | `/api/me/permissions` | Current user's permission codes |

### WebRTC Live (`api/live_views.py`)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/live` | List active live sessions |
| POST | `/api/live/start` | Start a live session (candidate) |
| GET | `/api/live/<sid>` | Get session state |
| POST | `/api/live/<sid>/answer` | Recruiter posts SDP answer |
| POST | `/api/live/<sid>/ice` | Post ICE candidates |
| PATCH | `/api/live/<sid>/update` | Update transcript / question |
| POST | `/api/live/<sid>/end` | End live session |

### Utility
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/config` | Client config (feature flags etc.) |
| GET | `/api/health` | Health check |

---

## RBAC System (`api/permissions.py`)

### How Auth Works
- **No Django auth** — all user identity comes from the `X-User-Email` request header.
- The `permissions.py` module resolves the caller via `AppUser.objects.filter(email=...).first()`.
- `X-Actor-Email` is also accepted as a fallback header.

### Decorators

```python
# Require a specific permission (single code or method-keyed dict)
@require_perm('recruitment.view')
@require_perm({'GET': 'employee.view', 'POST': 'employee.create'})

# Allow if permission OR if acting on own data
@require_perm('leave.create', or_self=True)

# Only Super Admin
@require_admin
```

### Permission Codes (seeded by `seed_rbac.py`)

| Module | Codes |
|---|---|
| Recruitment | `recruitment.view`, `recruitment.create`, `recruitment.edit`, `recruitment.delete` |
| Employees | `employee.view`, `employee.create`, `employee.edit`, `employee.delete` |
| Attendance | `attendance.view`, `attendance.create`, `attendance.edit`, `attendance.delete` |
| Leave | `leave.view`, `leave.create`, `leave.approve`, `leave.delete` |
| Payroll | `payroll.view`, `payroll.manage` |
| Settings | `settings.view`, `settings.manage` |
| RBAC | `rbac.view`, `rbac.manage` |

### Default Roles

| Role | Description |
|---|---|
| `Super Admin` | Bypasses all permission checks |
| `HR Manager` | All permissions except `rbac.manage` |
| `HR Executive` | `recruitment.*` (no delete), `employee.view`, `attendance.view`, `leave.view`, `settings.view` |
| `Employee` | `employee.view`, `attendance.view/create`, `leave.view/create`, `settings.view` |

### Legacy Role Mapping

Old `app_users.role` strings map to RBAC roles:
- `admin` → `Super Admin`
- `hr` → `HR Manager`
- `recruitment` → `HR Executive`

### Super Admin Bypass Logic

- If `role_ref` is set → Super Admin **only if** `role_ref.name == 'Super Admin'`
- If `role_ref` is NULL → Super Admin if legacy `role == 'admin'` (fallback for old accounts)

---

## AI Integration (`api/ai.py`)

- **Generation model:** `claude-sonnet-4-5` (override via `ANTHROPIC_MODEL` env var)
- **Validation model:** `claude-haiku-4-5` (override via `ANTHROPIC_VALIDATION_MODEL` env var)
- If no API key → **local fallback** generates plausible questions from prompt text
- `POST /api/ai/generate-questions` accepts:
  - `prompt` (raw string)
  - OR structured: `resumeText`, `jdText`, `jobRole`, `experienceLevel`, `skills[]`, `candidateName`, `questionCount`
- Returns Anthropic-style `{content: [{text: "[\"Q1\", \"Q2\", ...]"}]}`

---

## Email System (`api/mailer.py`)

Priority order for sending:
1. **Resend API** (if `RESEND_API_KEY` is set in env)
2. **Per-user SMTP** (from `UserEmailConfig` for the sender's email)
3. **Global SMTP** (from `.env` `SMTP_*` variables)

Used for: OTP delivery, password reset links, interview invitations, follow-up emails.

---

## Social Auto-Posting (`api/social_poster.py`)

When a job is created (`POST /api/jobs`), if `userEmail` is in the request body, the system looks up `UserEmailConfig.social` for that user and posts to:
- **LinkedIn** (UGC Posts API) — requires `accessToken` + `authorUrn`
- **X/Twitter** (v2 API) — requires `accessToken`

Posting failures are non-fatal — job creation always succeeds.

---

## WebRTC Live Interview (`api/live_views.py`)

- REST-based SDP/ICE signaling (no WebSocket server needed)
- Candidate browser publishes offer + ICE via `POST /api/live/start` and `POST /api/live/<sid>/ice`
- Recruiter fetches session state via `GET /api/live/<sid>`, posts SDP answer
- Media flows **peer-to-peer** (browser to browser) — no media server
- STUN preconfigured; TURN must be added manually in `dist/assets/hrms-live.js` for restrictive networks

---

## Management Commands

```bash
# Seed default Modules, Roles, PermissionGroups, Permissions
python manage.py seed_rbac

# Seed demo data
python manage.py seed_data

# Remove demo data
python manage.py cleanup_demo_data

# List notifications for a user
python manage.py list_notifications <email>

# Run smoke tests (SQLite, SMTP mocked)
python smoke.py
```

---

## Key Conventions & Design Decisions

1. **No `django.contrib.auth`** — `AppUser` is the only user model; no `request.user`.
2. **Email as identity** — users are keyed by email string across all tables, not by FK integer.
3. **Plain-text passwords** — `app_users.password` stores plain text to match legacy admin UI "Show" feature. OTP codes use SHA-256 + salt.
4. **No trailing slashes** — `APPEND_SLASH = False`; all API paths are slash-free.
5. **No migrations needed for existing tables** — `migrate` only creates new tables (`login_otps`, `password_resets`, `live_sessions`, RBAC tables).
6. **`USE_TZ = False`** — all datetimes are naive (UTC assumed, matching Node server).
7. **RBAC is additive** — adding `role_ref` to a user does not break old `role` string behaviour; legacy role is the fallback.
8. **Permission check grace period** — if `X-User-Email` header is missing, requests are currently **allowed** (logged as debug). Once all clients send the header, change to deny.
9. **Frontend is pre-built** — the `dist/` bundle is checked in. Some `dist/assets/hrms-*.js` files are standalone modules loaded via `<script>` tags in `index.html`.
10. **Large file uploads** — `DATA_UPLOAD_MAX_MEMORY_SIZE = None` and `FILE_UPLOAD_MAX_MEMORY_SIZE = 500 MB` to support base64 video and document uploads.

---

## Running Locally

```bash
cd hrms_django

# Install dependencies
pip install -r requirements.txt

# Run DB migrations (creates RBAC + auth tables; existing tables are unchanged)
python manage.py migrate

# Seed RBAC defaults (roles, permissions, modules)
python manage.py seed_rbac

# Start dev server (serves API + React SPA)
python manage.py runserver 0.0.0.0:8000
```

The app is then available at `http://localhost:8000`.
API is under `http://localhost:8000/api/`.

> **SMTP must be configured** in `.env.development` or Settings -> Email Configuration before OTP login works.
