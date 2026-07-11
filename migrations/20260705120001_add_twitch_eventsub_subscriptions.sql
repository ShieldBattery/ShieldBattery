-- Tracks the Twitch EventSub subscription ids (stream.online + stream.offline) we created for each
-- linked broadcaster, so they can be deleted when the account is unlinked and reconciled on boot.
-- Ephemeral live state lives in Redis, not here.
ALTER TABLE twitch_connections
  ADD COLUMN eventsub_subscription_ids text[] NOT NULL DEFAULT '{}';
