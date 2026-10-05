-- no-transaction

-- Serves the admin queue (and report count) of dispute review requests that are still awaiting an
-- admin. Built concurrently because `games` is large and a plain build would block writes to it
-- for the whole table scan, even though few rows match.

CREATE INDEX CONCURRENTLY idx_games_pending_dispute_requests
ON games (dispute_requested_at DESC)
WHERE dispute_requested AND NOT dispute_reviewed;
