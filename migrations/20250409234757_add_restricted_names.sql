-- Create an enum for the different types of restrictions
CREATE TYPE restricted_name_kind AS ENUM
(
  'exact',
  'regex'
);

CREATE TYPE restricted_name_reason AS ENUM
(
  'profanity',
  'reserved'
);

CREATE TABLE restricted_names
(
  id SERIAL PRIMARY KEY,
  pattern TEXT NOT NULL,
  kind restricted_name_kind NOT NULL DEFAULT 'exact',
  reason restricted_name_reason NOT NULL DEFAULT 'profanity',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by int4 NOT NULL REFERENCES users(id),

  UNIQUE (pattern, kind)
);
