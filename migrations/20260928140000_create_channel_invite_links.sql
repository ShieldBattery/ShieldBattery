-- Invite links into private channels. The link's `id` is its token: holding it is what lets someone
-- join the channel, so it must stay unguessable. A link is usable while its channel is private,
-- `expires_at` is null or in the future, and `max_uses` is null or greater than `uses`.
CREATE TABLE channel_invite_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id integer NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  created_by integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz,
  max_uses integer,
  uses integer NOT NULL DEFAULT 0
);

CREATE INDEX channel_invite_links_channel_id_idx ON channel_invite_links (channel_id);

-- The creator of the invite link a member joined through, or null for any other kind of join.
ALTER TABLE channel_users
  ADD COLUMN invited_by integer REFERENCES users(id) ON DELETE SET NULL;
