-- =============================================================================
-- HRMS AI — Database Migration Script
-- Run against the `hrms_ai` MySQL database BEFORE restarting Django.
-- All statements use IF NOT EXISTS / IGNORE so they are safe to re-run.
-- =============================================================================

USE `hrms_ai`;

-- -----------------------------------------------------------------------------
-- 1. app_users — Google OAuth support
-- -----------------------------------------------------------------------------

-- Authentication provider: 'email' (default) or 'google'
ALTER TABLE `app_users`
  ADD COLUMN IF NOT EXISTS `auth_provider` VARCHAR(20) NOT NULL DEFAULT 'email'
  AFTER `status`;

-- Google account subject ID (unique per Google account)
ALTER TABLE `app_users`
  ADD COLUMN IF NOT EXISTS `google_id` VARCHAR(128) NULL DEFAULT NULL
  AFTER `auth_provider`;

-- Google profile picture URL / base64
ALTER TABLE `app_users`
  ADD COLUMN IF NOT EXISTS `profile_pic` TEXT NULL DEFAULT NULL
  AFTER `google_id`;

-- Allow empty password for Google-only accounts
ALTER TABLE `app_users`
  MODIFY COLUMN `password` VARCHAR(255) NOT NULL DEFAULT '';

-- Unique index on google_id (one Google account = one HRMS account)
CREATE UNIQUE INDEX IF NOT EXISTS `app_users_google_id_unique`
  ON `app_users` (`google_id`);

-- -----------------------------------------------------------------------------
-- 2. interview_links — Token-based access + Resume/JD storage
-- -----------------------------------------------------------------------------

-- Unique access token for the candidate
ALTER TABLE `interview_links`
  ADD COLUMN IF NOT EXISTS `candidate_token` VARCHAR(128) NULL DEFAULT NULL
  AFTER `interview_questions`;

-- Unique access token for the recruiter
ALTER TABLE `interview_links`
  ADD COLUMN IF NOT EXISTS `recruiter_token` VARCHAR(128) NULL DEFAULT NULL
  AFTER `candidate_token`;

-- When the interview links expire (set to interview start + 24 hours)
ALTER TABLE `interview_links`
  ADD COLUMN IF NOT EXISTS `link_expires_at` DATETIME NULL DEFAULT NULL
  AFTER `recruiter_token`;

-- Store resume text for AI-enhanced question generation
ALTER TABLE `interview_links`
  ADD COLUMN IF NOT EXISTS `resume_text` LONGTEXT NULL DEFAULT NULL
  AFTER `link_expires_at`;

-- Store JD text for AI-enhanced question generation
ALTER TABLE `interview_links`
  ADD COLUMN IF NOT EXISTS `jd_text` LONGTEXT NULL DEFAULT NULL
  AFTER `resume_text`;

-- Indexes for fast token lookup
CREATE INDEX IF NOT EXISTS `interview_links_candidate_token_idx`
  ON `interview_links` (`candidate_token`);

CREATE INDEX IF NOT EXISTS `interview_links_recruiter_token_idx`
  ON `interview_links` (`recruiter_token`);

-- -----------------------------------------------------------------------------
-- 3. Backfill: generate tokens for existing interviews that don't have them
--    (safe to run; only updates rows where tokens are NULL)
-- -----------------------------------------------------------------------------

-- We can't generate cryptographic tokens in pure SQL, so we use UUID as a
-- reasonable placeholder. Django will overwrite these on the next PUT/save.
UPDATE `interview_links`
SET
  `candidate_token` = REPLACE(UUID(), '-', ''),
  `recruiter_token`  = REPLACE(UUID(), '-', ''),
  `link_expires_at`  = CASE
    WHEN `interview_date` IS NOT NULL AND `interview_time` IS NOT NULL
    THEN DATE_ADD(
      STR_TO_DATE(CONCAT(`interview_date`, ' ', `interview_time`), '%Y-%m-%d %H:%i'),
      INTERVAL 24 HOUR
    )
    ELSE DATE_ADD(NOW(), INTERVAL 24 HOUR)
  END
WHERE `candidate_token` IS NULL;

-- =============================================================================
-- Done. Run: python manage.py migrate   (applies the Django migration too)
-- =============================================================================


show tables;


select * from app_users;

select * from login_otps;


select * from app_users;


select * from user_profiles;


select * from app_users;


show tables;


select * from audit_logs;


select * from employee_attendance;


select * from work_submissions;

select * from employee_tasks;
select * from leave_requests;

select * from attendance_events;


SELECT * from employee_attendance;
