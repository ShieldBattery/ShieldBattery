exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE channels
    DROP COLUMN banner_id;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE channels
    ADD COLUMN banner_id uuid;
  `)
}

exports._meta = {
  version: 1,
}
