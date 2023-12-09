exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE channels
    ADD COLUMN banner_path text,
    ADD COLUMN badge_path text;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE channels
    DROP COLUMN banner_path,
    DROP COLUMN badge_path;
  `)
}

exports._meta = {
  version: 1,
}
