-- When the "league started" notifications for this league were handled. NULL until the league's
-- `start_at` has passed and the notification job claims it. Leagues that had already started when
-- this column was added are marked as handled without any notifications having been sent.
ALTER TABLE leagues
  ADD COLUMN start_notified_at TIMESTAMPTZ;

UPDATE leagues
SET start_notified_at = NOW()
WHERE start_at <= NOW();
