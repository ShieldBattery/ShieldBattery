-- Persistent link between a ShieldBattery user and their Twitch account, established via Twitch
-- OAuth (see the twitch GraphQL module in server-rs). Only the stable identity is stored here: the
-- live stream (online/offline) state is ephemeral and tracked in Redis, and OAuth access/refresh
-- tokens are intentionally NOT persisted -- the streaming feature only needs an app access token
-- plus the broadcaster's Twitch user id, so we avoid storing user secrets we don't use.
CREATE TABLE twitch_connections (
  -- One Twitch account per SB user, so the SB user id is the primary key.
  user_id integer PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  -- Twitch's stable, immutable numeric user id (survives channel renames). UNIQUE so a single
  -- Twitch channel can't be claimed by two different SB accounts.
  twitch_user_id text NOT NULL UNIQUE,
  -- The Twitch login name (lowercase; used in twitch.tv/<login> URLs) and display name, cached for
  -- display and refreshed whenever the user re-links.
  twitch_login text NOT NULL,
  twitch_display_name text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
