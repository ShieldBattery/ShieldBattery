-- Per-(user, channel) preference for whether membership activity marks the channel unread.
-- `unread_on_join_leave` controls whether a join, leave, kick, ban or owner-change event arriving
-- unseen raises the unread flag. When false those events still render and still update membership,
-- they just don't raise unread state. Text messages are unaffected.

ALTER TABLE channel_users
  ADD COLUMN unread_on_join_leave boolean NOT NULL DEFAULT true;
