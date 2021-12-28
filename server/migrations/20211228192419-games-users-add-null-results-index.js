exports.up = async function (db) {
  await db.runSql(`
    CREATE INDEX games_users_null_result_index
    ON games_users (game_id)
    INCLUDE (reported_at)
    WHERE ((reported_results IS NOT NULL AND result IS NULL))
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    DROP INDEX games_users_null_result_index
  `)
}

exports._meta = {
  version: 1,
}
