-- no-transaction

-- A concurrent build keeps identifier writes available while the index is populated.
CREATE UNIQUE INDEX CONCURRENTLY user_identifiers_source_key
  ON user_identifiers (user_id, identifier_type, identifier_hash, source);
