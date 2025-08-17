-- Add column to track last login name change
ALTER TABLE users ADD COLUMN last_login_name_change timestamptz;
