-- A user's chosen position for a channel in their list of joined channels, lowest first.
--
-- Nullable with no default: a channel the user hasn't placed (every channel, for a user who has never
-- reordered, and any channel joined since their last reorder) sorts after the placed ones, in join
-- order.

ALTER TABLE channel_users
  ADD COLUMN sort_order integer;
