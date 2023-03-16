exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE leagues
    ADD COLUMN badge_path text;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE leagues
    DROP COLUMN badge_path;
  `)
}

exports._meta = {
  version: 1,
}
