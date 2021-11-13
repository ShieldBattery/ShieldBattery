exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE maps ADD COLUMN parser_version INTEGER NOT NULL DEFAULT 1;
  `)

  await db.runSql(`
    ALTER TABLE maps ADD COLUMN image_version INTEGER NOT NULL DEFAULT 1;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE maps DROP COLUMN image_version;
  `)
  await db.runSql(`
    ALTER TABLE maps DROP COLUMN parser_version;
  `)
}

exports._meta = {
  version: 1,
}
