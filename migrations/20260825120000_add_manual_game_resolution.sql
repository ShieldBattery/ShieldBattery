-- Records that an admin hand-assigned a game's outcomes after automatic reconciliation ended in a
-- dispute. NULL in both columns means the game was never manually resolved; the pair is always set
-- together.
ALTER TABLE games
  ADD COLUMN manually_resolved_by INTEGER REFERENCES users (id),
  ADD COLUMN manually_resolved_at TIMESTAMPTZ;
