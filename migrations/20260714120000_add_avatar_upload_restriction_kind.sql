-- no-transaction

-- Adds the `avatar_upload` value to the restriction_kind enum so admins can restrict a user from
-- uploading profile avatars (e.g. for repeatedly uploading inappropriate images). It reuses the
-- time-bound, admin-attributed user_restrictions system (with the evasion-resistant identifier
-- variant), just as the `chat`, `reporting`, and `matchmaking` kinds do. Removing an existing
-- avatar stays allowed while restricted.
--
-- `ALTER TYPE ... ADD VALUE` runs outside a transaction here: sqlx wraps each migration body in an
-- implicit transaction block, and an enum value added inside a transaction can't be used until that
-- transaction commits. We don't use the value in this migration, but the `-- no-transaction`
-- directive keeps it unambiguous and matches the project convention for statements that don't
-- belong in a transaction block.
ALTER TYPE restriction_kind ADD VALUE IF NOT EXISTS 'avatar_upload';
