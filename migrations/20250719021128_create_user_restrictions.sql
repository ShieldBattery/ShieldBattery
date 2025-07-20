-- Both of these enums will need to be expanded in the future, this is just what seems useful for
-- chat restrictions
CREATE TYPE restriction_kind AS ENUM (
  'chat'
);

CREATE TYPE restriction_reason AS ENUM (
  'spam',
  'harassment',
  'hate_speech',
  'toxicity',
  'disruptive_behavior',
  'other'
);

CREATE TABLE user_identifier_restrictions(
  id uuid PRIMARY KEY DEFAULT sb_uuid(),
  identifier_type int2 NOT NULL,
  identifier_hash bytea NOT NULL,
  kind restriction_kind NOT NULL,
  start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_time TIMESTAMPTZ NOT NULL,
  -- The admin the applied the restriction
  restricted_by int4 REFERENCES users(id) ON DELETE SET NULL,
  -- The user the restriction was applied directly to
  first_user_id int4 REFERENCES users(id) ON DELETE SET NULL,
  reason restriction_reason NOT NULL,
  admin_notes TEXT,

  UNIQUE (identifier_type, identifier_hash, kind)
);

CREATE TABLE user_restrictions(
  id uuid PRIMARY KEY DEFAULT sb_uuid(),
  user_id int4 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind restriction_kind NOT NULL,
  start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_time TIMESTAMPTZ NOT NULL,
  -- The admin the applied the restriction
  restricted_by int4 REFERENCES users(id) ON DELETE SET NULL,
  reason restriction_reason NOT NULL,
  admin_notes TEXT
);

CREATE INDEX idx_user_restrictions_user_kind_end_time
ON user_restrictions (user_id, kind, end_time DESC);
