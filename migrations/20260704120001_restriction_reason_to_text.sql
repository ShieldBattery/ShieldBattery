-- Restriction reasons are becoming per-kind: chat keeps its original presets, reporting has none,
-- matchmaking gets its own set, and future kinds will bring their own. A single shared DB enum would
-- accumulate unrelated values and need a migration per new reason, so we move the reason column to
-- free-form nullable text and let the application own which presets are valid for each kind. Writes
-- are still validated against the per-kind preset list (RESTRICTION_REASONS_BY_KIND), so stored
-- values remain well-known; reporting (and any future preset-less kind) simply stores NULL.

ALTER TABLE user_restrictions
  ALTER COLUMN reason TYPE text USING reason::text,
  ALTER COLUMN reason DROP NOT NULL;

ALTER TABLE user_identifier_restrictions
  ALTER COLUMN reason TYPE text USING reason::text,
  ALTER COLUMN reason DROP NOT NULL;

DROP TYPE restriction_reason;
