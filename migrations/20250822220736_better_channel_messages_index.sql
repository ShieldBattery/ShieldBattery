-- Add a better channel_messages index that includes the channel_id so we can query messages in
-- order without re-sorting. The previous one only had `sent` regardless of channel, so, not that
-- useful in practice
CREATE INDEX channel_messages_channel_id_sent_idx
ON channel_messages (channel_id, sent DESC);

DROP INDEX channel_messages_channel_id_index;
DROP INDEX channel_messages_sent_index;
