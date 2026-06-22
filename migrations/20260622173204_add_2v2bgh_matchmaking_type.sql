-- no-transaction

-- Adds the `2v2bgh` value to the matchmaking_type enum for the 2v2 Big Game Hunters mode (the first
-- fixed-map mode). `ALTER TYPE ... ADD VALUE` runs outside a transaction here: sqlx wraps each
-- migration body in an implicit transaction block, and an enum value added inside a transaction
-- can't be used until that transaction commits. We don't use the value in this migration, but the
-- `-- no-transaction` directive keeps it unambiguous and matches the project convention for
-- statements that don't belong in a transaction block.

ALTER TYPE public.matchmaking_type ADD VALUE IF NOT EXISTS '2v2bgh';
