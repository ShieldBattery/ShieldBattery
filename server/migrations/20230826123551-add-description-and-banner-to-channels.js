exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE channels
    ADD COLUMN description text,
    ADD COLUMN banner_id uuid;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE channels
    DROP COLUMN description,
    DROP COLUMN banner_id;
  `)
}

exports._meta = {
  version: 1,
}
