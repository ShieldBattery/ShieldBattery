exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE permissions
    DROP COLUMN edit_all_channels;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE permissions
    ADD COLUMN edit_all_channels boolean NOT NULL DEFAULT false;
  `)
}

exports._meta = {
  version: 1,
}
