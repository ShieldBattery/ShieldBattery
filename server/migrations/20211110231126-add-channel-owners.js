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

  // Give the channel ownership (and all the other permissions) to the earliest joined user.
  await db.runSql(`
    WITH o AS (
      SELECT DISTINCT ON (channel_name) *
      FROM joined_channels
      ORDER BY channel_name, join_date
    )
    UPDATE joined_channels AS jc
    SET kick = true, ban = true, change_topic = true, toggle_private = true,
      edit_permissions = true, owner = true
    FROM o
    WHERE jc.user_id = o.user_id AND jc.channel_name = o.channel_name;
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
