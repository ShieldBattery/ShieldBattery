exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE uploaded_maps
    ADD COLUMN removed_at timestamp without time zone;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE uploaded_maps
    DROP COLUMN removed_at;
  `)
}

exports._meta = {
  version: 1,
}
