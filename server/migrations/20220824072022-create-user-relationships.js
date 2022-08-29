exports.up = async function (db) {
  await db.runSql(`
    CREATE TYPE relationship_kind AS ENUM (
      'friend',
      'friend_request_low_to_high', 'friend_request_high_to_low',
      'block_low_to_high', 'block_high_to_low', 'block_both');
  `)

  await db.runSql(`
    CREATE TABLE user_relationships (
      user_low integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_high integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind relationship_kind NOT NULL,
      low_created_at timestamp without time zone,
      high_created_at timestamp without time zone,

      PRIMARY KEY(user_low, user_high),
      CHECK (user_low < user_high)
    );
  `)

  await db.runSql(`
    CREATE INDEX ON user_relationships(user_high);
  `)
}

exports.down = async function (db) {
  await db.runSql(`DROP TABLE user_relationships;`)
  await db.runSql(`DROP TYPE relationship_kind;`)
}

exports._meta = {
  version: 1,
}
