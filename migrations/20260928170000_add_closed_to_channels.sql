-- Whether server moderators have closed the channel. A closed channel has no members and refuses
-- every join, but keeps its name and history, so it survives being empty.
ALTER TABLE channels
  ADD COLUMN closed boolean NOT NULL DEFAULT false;
