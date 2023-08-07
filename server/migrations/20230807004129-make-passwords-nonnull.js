exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE users_private
    ALTER COLUMN password SET NOT NULL;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE users_private
    ALTER COLUMN password SET NULL;
  `)
}

exports._meta = {
  version: 1,
}
