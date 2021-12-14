exports.up = async function (db) {
  await db.runSql(`
    CREATE INDEX game_id_index ON matchmaking_rating_changes (game_id);
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    DROP INDEX game_id_index;
  `)
}

exports._meta = {
  version: 1,
}
