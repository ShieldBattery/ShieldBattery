exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE channels
    DROP COLUMN password;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE channels
    ADD COLUMN password text;
  `)
}

exports._meta = {
  version: 1,
}
