-- no-transaction

-- Index to serve clearing a closed lobby's outstanding invites (clearMatching in
-- server/lib/notifications/notification-model.ts), which filters WHERE visible = true AND
-- data->>'type' = 'lobbyInvite' AND data->>'lobbyId' = $1. That query has no user_id, so
-- idx_notifications_user_visible_created can't serve it, and notification_type_index alone makes
-- it read every lobby invite ever sent, cleared ones included, each time a lobby closes.
--
-- Partial on visible lobby invites, so it only holds the outstanding ones and adds no write cost
-- to other kinds of notification.
--
-- Builds CONCURRENTLY (hence `-- no-transaction`, since CREATE INDEX CONCURRENTLY can't run
-- inside a transaction) to avoid locking out writes to `notifications` while it builds.

CREATE INDEX CONCURRENTLY idx_notifications_visible_lobby_invite_lobby_id
ON notifications ((data->>'lobbyId'))
WHERE visible AND data->>'type' = 'lobbyInvite';
