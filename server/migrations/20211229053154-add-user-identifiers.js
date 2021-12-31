exports.up = async function (db) {
  await db.runSql(`
    CREATE TABLE user_identifiers (
      user_id integer NOT NULL,
      identifier_type smallint NOT NULL,
      identifier_hash bytea NOT NULL,
      first_used timestamp without time zone NOT NULL,
      last_used timestamp without time zone NOT NULL,
      times_seen integer NOT NULL DEFAULT 1,

      PRIMARY KEY (user_id, identifier_type, identifier_hash)
    );
  `)

  await db.runSql(`
    CREATE INDEX user_identifiers_identifier_type_hash_index
    ON user_identifiers (identifier_type, identifier_hash);
  `)
}

exports.down = async function (db) {
  await db.runSql(`DROP TABLE user_identifiers`)
}

exports._meta = {
  version: 1,
}
