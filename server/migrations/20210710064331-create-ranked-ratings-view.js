exports.up = async function (db) {
  await db.runSql(`
    CREATE MATERIALIZED VIEW ranked_matchmaking_ratings_view AS
    SELECT RANK() OVER (ORDER BY r.rating DESC) as rank, r.user_id, r.rating,
          r.wins, r.losses, r.last_played_date
    FROM matchmaking_ratings r
    WHERE r.num_games_played > 0
  `)

  await db.runSql(`
    CREATE UNIQUE INDEX ranked_matchmaking_ratings_view_user_id
    ON ranked_matchmaking_ratings_view (user_id)
  `)
  await db.runSql(`
    CREATE INDEX ranked_matchmaking_ratings_view_rating
    ON ranked_matchmaking_ratings_view (rating DESC)
  `)
}

exports.down = async function (db) {
  await db.runSql(`DROP MATERIAIZED VIEW ranked_matchmaking_ratings_view`)
}

exports._meta = {
  version: 1,
}
