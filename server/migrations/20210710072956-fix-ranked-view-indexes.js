exports.up = async function (db) {
  await db.runSql(`
    DROP INDEX ranked_matchmaking_ratings_view_rating
  `)

  await db.runSql(`
    CREATE INDEX ranked_matchmaking_ratings_view_rank
    ON ranked_matchmaking_ratings_view (rank)
  `)
}

exports.down = async function (db) {
  await db.runSql(`DROP INDEX ranked_matchmaking_ratings_view_rank`)
}

exports._meta = {
  version: 1,
}
