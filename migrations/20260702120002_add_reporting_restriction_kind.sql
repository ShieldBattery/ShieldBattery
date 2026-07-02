-- no-transaction

-- Adds the `reporting` value to the restriction_kind enum so the existing user_restrictions system
-- (time-bound, admin-attributed, with the evasion-resistant identifier variant) can take reporting
-- privileges away from someone who abuses them — no new tables, just a new kind. The enum's
-- original comment already anticipated expansion beyond 'chat'.
--
-- `ALTER TYPE ... ADD VALUE` runs outside a transaction here: sqlx wraps each migration body in an
-- implicit transaction block, and an enum value added inside a transaction can't be used until that
-- transaction commits. We don't use the value in this migration, but the `-- no-transaction`
-- directive keeps it unambiguous and matches the project convention for statements that don't
-- belong in a transaction block.
ALTER TYPE restriction_kind ADD VALUE IF NOT EXISTS 'reporting';
