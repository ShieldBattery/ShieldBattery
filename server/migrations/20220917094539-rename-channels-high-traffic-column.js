exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE channels
    RENAME COLUMN high_traffic TO official;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE channels
    RENAME COLUMN official TO high_traffic;
  `)
}

exports._meta = {
  version: 1,
}
