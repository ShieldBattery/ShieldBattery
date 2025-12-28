-- Replace the existing channel_id index with a covering index that includes user_id.
-- This allows index-only scans when fetching user_ids for a channel.

DROP INDEX IF EXISTS channel_users_channel_id_index;

CREATE INDEX channel_users_channel_id_user_id_idx
ON channel_users (channel_id) INCLUDE (user_id);
