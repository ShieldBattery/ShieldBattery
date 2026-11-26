-- Per-(user, channel) preference for whether the channel's message list leaves out join and leave
-- lines. Only rendering is affected: the messages are still stored. While true, joins and leaves
-- never mark the channel unread for that user. Kick, ban and owner-change lines stay visible.

ALTER TABLE channel_users
  ADD COLUMN hide_join_leave boolean NOT NULL DEFAULT false;
