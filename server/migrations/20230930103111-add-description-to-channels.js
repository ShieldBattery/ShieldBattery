exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE channels
    ADD COLUMN description text;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE channels
    DROP COLUMN description;
  `)
}

exports._meta = {
  version: 1,
}
