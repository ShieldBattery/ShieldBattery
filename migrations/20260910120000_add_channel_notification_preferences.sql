-- Per-(user, channel) notification preferences. `notification_level` controls which messages alert
-- the user (the alert sound, plus the transient tray icon and taskbar flash): 'all' alerts on every
-- message, 'mentions' only on messages that mention the user, 'nothing' never alerts. `muted`
-- silences the channel further: while true, a message that doesn't mention the user neither alerts
-- nor marks the channel unread, regardless of `notification_level`; mentions still alert (subject to
-- `notification_level`) and still show as unread.

ALTER TABLE channel_users
  ADD COLUMN notification_level text NOT NULL DEFAULT 'mentions'
    CHECK (notification_level IN ('all', 'mentions', 'nothing')),
  ADD COLUMN muted boolean NOT NULL DEFAULT false;
