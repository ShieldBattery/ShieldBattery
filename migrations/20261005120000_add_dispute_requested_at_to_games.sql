-- When a participant asked an admin to review a disputed game's results. NULL whenever
-- `dispute_requested` is false; it is kept after the request has been reviewed, alongside
-- `dispute_requested`, as the record of when the request was made.
ALTER TABLE games
  ADD COLUMN dispute_requested_at TIMESTAMPTZ;
