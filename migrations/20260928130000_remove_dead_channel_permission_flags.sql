-- `change_topic` and `toggle_private` are grantable member permissions that no server code path
-- ever consults: topic changes are gated on channel ownership/moderation alone, and there is no
-- action that flips a channel's privacy for `toggle_private` to gate.
ALTER TABLE channel_users DROP COLUMN change_topic;
ALTER TABLE channel_users DROP COLUMN toggle_private;
