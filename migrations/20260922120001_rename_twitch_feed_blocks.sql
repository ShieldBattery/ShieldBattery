-- Feed blocks are keyed on the ShieldBattery user and cover every streaming platform that user has
-- linked, so the table is named for the feed it filters rather than for one platform.
ALTER TABLE twitch_feed_blocks RENAME TO live_stream_feed_blocks;
ALTER INDEX twitch_feed_blocks_pkey RENAME TO live_stream_feed_blocks_pkey;
ALTER TABLE live_stream_feed_blocks
  RENAME CONSTRAINT twitch_feed_blocks_user_id_fkey TO live_stream_feed_blocks_user_id_fkey;
ALTER TABLE live_stream_feed_blocks
  RENAME CONSTRAINT twitch_feed_blocks_blocked_by_fkey TO live_stream_feed_blocks_blocked_by_fkey;
