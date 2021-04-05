exports.up = async function (db) {
  await db.runSql(`
    CREATE INDEX data_level_index ON server_logs (((data->>'level')::int));
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    DROP INDEX data_level_index;
  `)
}

exports._meta = {
  version: 1,
}
