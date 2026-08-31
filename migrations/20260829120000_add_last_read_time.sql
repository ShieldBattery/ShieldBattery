-- Per-user read position for chat channels and whisper conversations. NULL means no read position
-- has ever been recorded, which the unread-detection queries treat as "everything is read" (a user
-- who never marked anything read has nothing they've missed, until a message actually arrives after
-- they join/start the conversation).
ALTER TABLE channel_users ADD COLUMN last_read_time timestamptz;
ALTER TABLE whisper_sessions ADD COLUMN last_read_time timestamptz;
