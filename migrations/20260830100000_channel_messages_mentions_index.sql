-- no-transaction
CREATE INDEX CONCURRENTLY channel_messages_mentions_idx
  ON channel_messages (channel_id, sent DESC)
  WHERE data ? 'mentions';
