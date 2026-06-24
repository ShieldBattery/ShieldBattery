-- no-transaction

-- Adds the remaining team matchmaking modes to the matchmaking_type enum: 2v2 Hunters, 2v2 Fastest,
-- 3v3 BGH, 3v3 Hunters, and 3v3 Fastest. `ALTER TYPE ... ADD VALUE` runs outside a transaction here:
-- sqlx wraps each migration body in an implicit transaction block, and an enum value added inside a
-- transaction can't be used until that transaction commits. We don't use the values in this
-- migration, but the `-- no-transaction` directive keeps it unambiguous and matches the project
-- convention for statements that don't belong in a transaction block.

ALTER TYPE public.matchmaking_type ADD VALUE IF NOT EXISTS '2v2hunters';
ALTER TYPE public.matchmaking_type ADD VALUE IF NOT EXISTS '2v2fastest';
ALTER TYPE public.matchmaking_type ADD VALUE IF NOT EXISTS '3v3bgh';
ALTER TYPE public.matchmaking_type ADD VALUE IF NOT EXISTS '3v3hunters';
ALTER TYPE public.matchmaking_type ADD VALUE IF NOT EXISTS '3v3fastest';
