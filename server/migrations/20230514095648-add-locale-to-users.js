exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE users
    ADD COLUMN locale text;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE users
    DROP COLUMN locale;
  `)
}

exports._meta = {
  version: 1,
}
