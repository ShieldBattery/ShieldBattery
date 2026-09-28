-- `change_topic` and `toggle_private` were grantable member permissions that nothing gated:
-- editing a channel's topic or privacy is reserved to its owner and server moderators.
ALTER TABLE channel_users DROP COLUMN change_topic;
ALTER TABLE channel_users DROP COLUMN toggle_private;
