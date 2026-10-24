CREATE TABLE user_ban_requests (
  request_id UUID PRIMARY KEY,
  target_id INTEGER NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL,
  ban_id UUID,
  ban_ids UUID[],
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((ban_id IS NULL) = (ban_ids IS NULL)),
  CHECK (ban_ids IS NULL OR (cardinality(ban_ids) > 0 AND ban_id = ANY(ban_ids))),
  CHECK (completed_at IS NULL OR ban_id IS NOT NULL)
);
