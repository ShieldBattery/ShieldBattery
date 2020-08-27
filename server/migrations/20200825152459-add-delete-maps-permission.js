exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE permissions
    ADD COLUMN delete_maps boolean NOT NULL DEFAULT false;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE permissions
    DROP COLUMN delete_maps;
  `)
}

exports._meta = {
  version: 1,
}
