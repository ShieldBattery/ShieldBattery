-- Persistent link between a ShieldBattery user and their YouTube channel, established via Google
-- OAuth (see the youtube GraphQL module in server-rs). Only the stable identity is stored here: the
-- live broadcast (online/offline) state is ephemeral and tracked in Redis, and OAuth access/refresh
-- tokens are intentionally NOT persisted -- live detection polls the channel's public uploads
-- playlist with our API key, so the user's token is needed once (to prove channel ownership) and
-- revoked immediately afterwards.
CREATE TABLE youtube_connections (
  -- One YouTube channel per SB user, so the SB user id is the primary key.
  user_id integer PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  -- YouTube's stable channel id (survives channel renames and handle changes). UNIQUE so a single
  -- YouTube channel can't be claimed by two different SB accounts.
  youtube_channel_id text NOT NULL UNIQUE,
  -- The channel's display title, cached for display and refreshed periodically.
  youtube_channel_title text NOT NULL,
  -- The channel's @handle (e.g. @flash) when it has one; channels are not required to have one.
  youtube_handle text,
  -- The channel's "uploads" playlist, which every public video (including live broadcasts) lands
  -- in. Cached at link time because resolving it costs a separate quota-charged API call, and it
  -- never changes for a given channel.
  uploads_playlist_id text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
