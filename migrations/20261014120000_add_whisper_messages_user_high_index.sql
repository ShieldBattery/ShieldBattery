-- no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS whisper_messages_user_high_idx
  ON whisper_messages (user_high, user_low, sent DESC);
