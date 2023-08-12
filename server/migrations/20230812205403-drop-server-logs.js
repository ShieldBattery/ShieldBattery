exports.up = async function (db) {
  await db.runSql(`
    DROP TABLE server_logs;
  `)
}

exports.down = async function (db) {
  // NOTE(tec27): Not bothering with a reverse migration since this won't be undone in dev
}

exports._meta = {
  version: 1,
}
