ALTER TABLE whisper_messages
  ADD COLUMN user_low  INT GENERATED ALWAYS AS (LEAST(from_id, to_id)) STORED,
  ADD COLUMN user_high INT GENERATED ALWAYS AS (GREATEST(from_id, to_id)) STORED;

CREATE INDEX whisper_messages_conversation_idx ON whisper_messages (user_low, user_high, sent DESC);

DROP INDEX whisper_messages_sent_index;
