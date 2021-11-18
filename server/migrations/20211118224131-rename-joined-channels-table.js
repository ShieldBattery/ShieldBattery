exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE joined_channels RENAME TO channel_users;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE channel_users RENAME TO joined_channels;
  `)
}

exports._meta = {
  version: 1,
}
