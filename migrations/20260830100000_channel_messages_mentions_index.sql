-- no-transaction

-- Index to serve the latest-unread-mention subquery in server/lib/chat/chat-models.ts
-- (getUnreadChannelInfo), which scans a channel's messages newest-first for ones whose `data`
-- has a `mentions` key. Messages that mention someone are a small fraction of all chat messages,
-- so a partial index keeps it cheap; the query's `m.data ? 'mentions'` predicate has to stay in
-- sync with this index's WHERE clause for the planner to use it.
--
-- Builds CONCURRENTLY (hence `-- no-transaction`, since CREATE INDEX CONCURRENTLY can't run
-- inside a transaction) to avoid locking out writes to `channel_messages` while it builds.

CREATE INDEX CONCURRENTLY channel_messages_mentions_idx
  ON channel_messages (channel_id, sent DESC)
  WHERE data ? 'mentions';
