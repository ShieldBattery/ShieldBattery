exports.up = function(db, cb) {
  db.runSql(
    `
      CREATE TABLE channels (
        name citext PRIMARY KEY,
        private boolean NOT NULL DEFAULT false,
        high_traffic boolean NOT NULL DEFAULT false,
        topic text,
        password text
      );`,
    addChannelNameConstraint,
  )

  function addChannelNameConstraint(err) {
    if (err) {
      cb(err)
      return
    }

    const sql = `ALTER TABLE channels ADD CONSTRAINT
        channel_name_length_check CHECK (length(name) <= 64);`
    db.runSql(sql, insertShieldBatteryChannel)
  }

  function insertShieldBatteryChannel(err) {
    if (err) {
      cb(err)
      return
    }
    const sql = "INSERT INTO channels (name, high_traffic) VALUES ('ShieldBattery', true);"
    db.runSql(sql, addPermissionsToJoinedChannels)
  }

  function addPermissionsToJoinedChannels(err) {
    if (err) {
      cb(err)
      return
    }

    const sql = `ALTER TABLE joined_channels
        ADD COLUMN kick boolean NOT NULL DEFAULT false,
        ADD COLUMN ban boolean NOT NULL DEFAULT false,
        ADD COLUMN change_topic boolean NOT NULL DEFAULT false,
        ADD COLUMN toggle_private boolean NOT NULL DEFAULT false,
        ADD COLUMN edit_permissions boolean NOT NULL DEFAULT false;`
    db.runSql(sql, addForeignKeysToJoinedChannels)
  }

  function addForeignKeysToJoinedChannels(err) {
    if (err) {
      cb(err)
      return
    }

    const sql = `ALTER TABLE joined_channels
        ADD CONSTRAINT fk_user_id FOREIGN KEY (user_id) REFERENCES users (id),
        ADD CONSTRAINT fk_channel_name FOREIGN KEY (channel_name) REFERENCES channels (name);`
    db.runSql(sql, cb)
  }
}

exports.down = function(db, cb) {
  db.runSql(
    `ALTER TABLE joined_channels
      DROP CONSTRAINT fk_user_id,
      DROP CONSTRAINT fk_channel_name;`,
    removePermissions,
  )

  function removePermissions(err) {
    if (err) {
      cb(err)
      return
    }

    db.runSql(
      `ALTER TABLE joined_channels
        DROP COLUMN kick,
        DROP COLUMN ban,
        DROP COLUMN change_topic,
        DROP COLUMN toggle_private,
        DROP COLUMN edit_permissions;`,
      dropChannels,
    )
  }

  function dropChannels(err) {
    if (err) {
      cb(err)
      return
    }

    db.dropTable('channels', cb)
  }
}
