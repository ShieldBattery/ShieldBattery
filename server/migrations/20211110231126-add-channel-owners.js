exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE joined_channels
    ADD COLUMN owner
    BOOLEAN NOT NULL DEFAULT false;
  `)

  await db.runSql(`
    CREATE UNIQUE INDEX joined_channels_owner
    ON joined_channels (channel_name, owner)
    WHERE owner = true;
  `)
}

exports.down = async function (db) {
  await db.runSql(`DROP INDEX joined_channels_owner`)

  await db.runSql(`
    ALTER TABLE joined_channels
    DROP COLUMN owner;
  `)
}

exports._meta = {
  version: 1,
}
