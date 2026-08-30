-- For whisper sessions, a NULL last_read_time means "unread since the session started" (the
-- recipient of a first-ever whisper has never had a chance to record a read position, and their
-- unread badge must survive a restart). Existing rows predate that rule, so they're stamped as
-- read-up-to-now once: without this, every conversation with any inbound message would surface an
-- unread badge the first time its owner's client loads read state.
--
-- channel_users.last_read_time keeps NULL = "everything is read": channels record a read position
-- on every visit, so NULL there only describes members who haven't viewed the channel at all yet.
UPDATE whisper_sessions
SET last_read_time = now()
WHERE last_read_time IS NULL;
