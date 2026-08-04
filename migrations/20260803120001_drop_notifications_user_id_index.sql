-- no-transaction

-- Drops the single-column user_id index (user_id_index), superseded by
-- idx_notifications_user_visible_created (20260803120000): every lookup plannable from a leading
-- user_id equality match is also plannable from the composite index, so keeping both would double
-- the index-maintenance cost on every notification write for no planner benefit.
--
-- Runs after 20260803120000 has built its replacement, so there is no window where the
-- notifications query (old or new shape) lacks index coverage. DROP INDEX CONCURRENTLY can't run
-- inside a transaction (hence `-- no-transaction`) and must be the only statement in its
-- migration.

DROP INDEX CONCURRENTLY IF EXISTS user_id_index;
