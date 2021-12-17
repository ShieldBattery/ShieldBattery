exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE games
    ADD COLUMN routes jsonb[] NULL;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE games
    DROP COLUMN routes;
  `)
}

exports._meta = {
  version: 1,
}
