SET LOCAL lock_timeout = '3s';

-- Writers naming this constraint work with either key shape.
ALTER TABLE user_identifiers
  DROP CONSTRAINT user_identifiers_pkey,
  ADD CONSTRAINT user_identifiers_pkey PRIMARY KEY USING INDEX user_identifiers_source_key;
