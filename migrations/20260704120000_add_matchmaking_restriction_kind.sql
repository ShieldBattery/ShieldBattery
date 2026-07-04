-- no-transaction

-- Adds the `matchmaking` value to the restriction_kind enum so admins can manually restrict a user
-- from matchmaking (for intentional leaving/griefing). This is separate from the automatic,
-- escalating dodge-ban in matchmaking_bans — it reuses the time-bound, admin-attributed
-- user_restrictions system (with the evasion-resistant identifier variant), just as the `chat` and
-- `reporting` kinds do.
--
-- `ALTER TYPE ... ADD VALUE` runs outside a transaction here: sqlx wraps each migration body in an
-- implicit transaction block, and an enum value added inside a transaction can't be used until that
-- transaction commits. We don't use the value in this migration, but the `-- no-transaction`
-- directive keeps it unambiguous and matches the project convention for statements that don't
-- belong in a transaction block.
ALTER TYPE restriction_kind ADD VALUE IF NOT EXISTS 'matchmaking';
