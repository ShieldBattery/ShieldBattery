exports.up = async function (db) {
  await db.runSql(`
    CREATE INDEX start_date_index ON matchmaking_times (start_date);
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    DROP INDEX start_date_index;
  `)
}

exports._meta = {
  version: 1,
}
