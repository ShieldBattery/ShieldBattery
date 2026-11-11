-- no-transaction

-- Adds the `map_publishing` value to the restriction_kind enum so admins can take away a user's
-- privilege to publish map files and to link or unlink the files they published. It reuses the
-- time-bound, admin-attributed user_restrictions system, just as the other kinds do.
--
-- `ALTER TYPE ... ADD VALUE` runs outside a transaction here: sqlx wraps each migration body in an
-- implicit transaction block, and an enum value added inside a transaction can't be used until that
-- transaction commits.
ALTER TYPE restriction_kind ADD VALUE IF NOT EXISTS 'map_publishing';
