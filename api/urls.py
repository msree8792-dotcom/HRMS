from django.urls import path

from . import auth_views, live_views, views

# All paths are relative to the "/api/" prefix from the project urlconf.
urlpatterns = [
    # Authentication (OTP login + password reset + Google OAuth)
    path('auth/login', auth_views.login),
    path('auth/verify-otp', auth_views.verify_otp),
    path('auth/resend-otp', auth_views.resend_otp),
    path('auth/forgot-password', auth_views.forgot_password),
    path('auth/reset-password', auth_views.reset_password),
    path('auth/verify-reset-token', auth_views.verify_reset_token),
    path('auth/google', auth_views.google_auth),

    path('jobs', views.jobs),

    path('interviews', views.interviews),
    path('interviews/bulk/send-emails', views.interviews_bulk_send_emails),
    path('interviews/send-followup', views.interview_send_followup),
    path('interviews/verify-token', views.interview_verify_token),
    path('interviews/<int:pk>', views.interview_detail),
    path('interviews/<int:pk>/regenerate-link', views.interview_regenerate_link),
    path('interviews/<int:pk>/resend-invitation', views.interview_resend_invitation),

    # Live interview (WebRTC signaling for recruiter live-view)
    path('live', live_views.live_list),
    path('live/start', live_views.live_start),
    path('live/<str:sid>', live_views.live_detail),
    path('live/<str:sid>/answer', live_views.live_answer),
    path('live/<str:sid>/ice', live_views.live_ice),
    path('live/<str:sid>/update', live_views.live_update),
    path('live/<str:sid>/end', live_views.live_end),

    path('resume-scores', views.resume_scores),

    path('interview-recordings', views.recordings),
    path('interview-recordings/<int:pk>', views.recording_detail),
    path('interview-recordings/<int:pk>/video', views.recording_video),

    path('question-sets', views.question_sets),
    path('question-sets/<str:set_id>', views.question_set_detail),

    path('ai/status', views.ai_status),
    path('ai/generate-questions', views.ai_generate_questions),

    path('users', views.users),
    path('users/<str:email>', views.user_detail),

    path('user-settings/<str:email>', views.user_settings),
    path('user-settings/<str:email>/profile', views.user_profile),
    path('user-settings/<str:email>/email-config', views.user_email_config),
    path('user-settings/<str:email>/documents', views.user_documents),
    path('user-settings/<str:email>/documents/<str:doc_type>', views.user_document_detail),

    # Employees module — Attendance / Check-In-Out
    path('attendance', views.attendance),
    path('attendance/check-in', views.attendance_check_in),
    path('attendance/check-out', views.attendance_check_out),
    path('attendance/today', views.attendance_today),
    path('attendance/events', views.attendance_events),
    path('attendance/team', views.attendance_team),
    path('attendance/presence', views.attendance_presence),
    path('attendance/<int:pk>', views.attendance_detail),

    # Employees module — Leave Management
    path('leave', views.leave),
    path('leave/balance', views.leave_balance),
    path('leave/<int:pk>', views.leave_detail),

    # Employees module — Task Tracker
    path('tasks', views.tasks),
    path('tasks/<int:pk>', views.task_detail),

    # Employees module — Work Submissions
    path('submissions', views.submissions),
    path('submissions/<int:pk>', views.submission_detail),

    path('config', views.client_config),
    path('health', views.health),
]
