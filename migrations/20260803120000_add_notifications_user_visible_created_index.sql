-- no-transaction

-- Index to serve the notifications query in server/lib/notifications/notification-model.ts
-- (retrieveNotifications), which filters WHERE user_id = $1 AND visible = $2 ORDER BY created_at
-- DESC LIMIT 100. This runs on every websocket connect. The existing single-column user_id index
-- (user_id_index) can only narrow the scan to a user's rows, leaving the visible filter and
-- ORDER BY to a sort; this composite index covers all three. Its leading user_id column also
-- serves any lookup user_id_index could, so that index is dropped as redundant in the next
-- migration.
--
-- Builds CONCURRENTLY (hence `-- no-transaction`, since CREATE INDEX CONCURRENTLY can't run
-- inside a transaction) to avoid locking out writes to `notifications` while it builds.

CREATE INDEX CONCURRENTLY idx_notifications_user_visible_created
ON notifications (user_id, visible, created_at DESC);
