exports.up = async function (db) {
  await db.runSql(`
    CREATE TABLE channel_identifier_bans (
      channel_id integer NOT NULL,
      identifier_type smallint NOT NULL,
      identifier_hash bytea NOT NULL,
      time_banned timestamp without time zone NOT NULL,
      first_user_id integer NOT NULL,

      PRIMARY KEY (channel_id, identifier_type, identifier_hash)
    );
  `)

  // Make banned_by nullable to indicate a system-enacted ban
  await db.runSql(`
    ALTER TABLE channel_bans
    ALTER COLUMN banned_by DROP NOT NULL;

    ALTER TABLE channel_bans
    ADD COLUMN automated boolean NOT NULL DEFAULT false;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    DROP TABLE channel_identifier_bans;
  `)

  // Gotta delete the rows where this column is NULL before making it not accept NULL values
  await db.runSql(`
    DELETE FROM channel_bans
    WHERE banned_by IS NULL;
  `)

  await db.runSql(`
    ALTER TABLE channel_bans
    ALTER COLUMN banned_by SET NOT NULL;

    ALTER TABLE channel_bans
    DROP COLUMN automated;
  `)
}

exports._meta = {
  version: 1,
}
