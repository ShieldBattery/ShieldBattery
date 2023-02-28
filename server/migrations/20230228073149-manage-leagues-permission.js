exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE permissions
    ADD COLUMN manage_leagues boolean NOT NULL DEFAULT false;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE permissions
    DROP COLUMN manage_leagues;
  `)
}

exports._meta = {
  version: 1,
}
