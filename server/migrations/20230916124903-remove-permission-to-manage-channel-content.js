exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE permissions
    DROP COLUMN manage_channel_content;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE permissions
    ADD COLUMN manage_channel_content boolean NOT NULL DEFAULT false;
  `)
}

exports._meta = {
  version: 1,
}
