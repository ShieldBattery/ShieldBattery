-- Identifies the transaction that's running, for grouping the history entries it writes: a hash of
-- its id and start time, since transaction ids alone start over when a database is restored into a
-- new cluster.
CREATE FUNCTION map_family_history_batch() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT md5(pg_current_xact_id()::text || ' ' || now()::text)::uuid $$;

-- The batch each history entry belongs to: every entry one transaction writes (e.g. one save of the
-- family editor) is one batch, undone together. Entries written before this column existed have
-- none and are each a batch of their own. The column is added without a default first, since a
-- volatile default would put every existing row in this migration's batch.
ALTER TABLE map_family_history ADD COLUMN batch_id uuid;
ALTER TABLE map_family_history ALTER COLUMN batch_id SET DEFAULT map_family_history_batch();

-- The time each entry was written rather than when its transaction started, so the entries of one
-- batch are ordered.
ALTER TABLE map_family_history ALTER COLUMN created_at SET DEFAULT clock_timestamp();

-- `undo` reverts a whole batch; its details hold `undoneEntryId`, the entry it was asked to undo.
ALTER TABLE map_family_history DROP CONSTRAINT map_family_history_kind_check;
ALTER TABLE map_family_history ADD CONSTRAINT map_family_history_kind_check CHECK (kind IN ('link',
  'remove', 'update_member', 'set_label', 'decide_suggestion', 'report_status', 'undo'));

CREATE INDEX map_family_history_batch_index ON map_family_history (batch_id)
  WHERE batch_id IS NOT NULL;
