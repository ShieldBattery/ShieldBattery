-- For channel members, a NULL last_read_time means "unread since joining the channel" (the unread
-- queries fall back to channel_users.join_date), matching the start_date rule for whisper
-- sessions. Existing rows predate read tracking entirely, so they're stamped as read-up-to-now
-- once: without this, the first deploy would surface every channel as unread since each member
-- joined, years of already-seen messages and mentions included. This supersedes the channels
-- paragraph of the whisper backfill migration, which described NULL as "everything is read".
UPDATE channel_users
SET last_read_time = now()
WHERE last_read_time IS NULL;
