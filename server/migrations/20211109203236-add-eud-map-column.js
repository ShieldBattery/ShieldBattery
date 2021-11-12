exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE maps ADD COLUMN is_eud BOOLEAN NOT NULL DEFAULT false;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE maps DROP COLUMN is_eud;
  `)
}

exports._meta = {
  version: 1,
}
