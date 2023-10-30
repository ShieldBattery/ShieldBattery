exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE channel_users
    ADD COLUMN hide_banner boolean NOT NULL DEFAULT false;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE channel_users
    DROP COLUMN hide_banner;
  `)
}

exports._meta = {
  version: 1,
}
