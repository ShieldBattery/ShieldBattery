exports.up = async function (db) {
  await db.runSql(`
    CREATE TABLE user_identifier_bans (
      identifier_type smallint NOT NULL,
      identifier_hash bytea NOT NULL,
      time_banned timestamp without time zone NOT NULL,
      banned_until timestamp without time zone NOT NULL,
      first_user_id integer NOT NULL,

      PRIMARY KEY (identifier_type, identifier_hash)
    );
  `)

  // Make banned_by nullable to indicate a system-enacted ban
  await db.runSql(`
    ALTER TABLE user_bans
    ALTER COLUMN banned_by DROP NOT NULL;
  `)
}

exports.down = async function (db) {
  await db.runSql(`DROP TABLE user_identifier_bans`)
  await db.runSql(`
    ALTER TABLE user_bans
    ALTER COLUMN banned_by SET NOT NULL;
  `)
}

exports._meta = {
  version: 1,
}
