exports.up = async function (db) {
  await db.runSql(`DROP MATERIALIZED VIEW ranked_matchmaking_ratings_view`)

  await db.runSql(`
    CREATE MATERIALIZED VIEW ranked_matchmaking_ratings_view AS
    SELECT RANK() OVER (
        PARTITION BY r.matchmaking_type
        ORDER BY r.rating DESC
      ) as rank,
      r.user_id, r.matchmaking_type, r.rating, r.wins, r.losses, r.last_played_date
    FROM matchmaking_ratings r
    WHERE r.num_games_played > 0
  `)

  // NOTE(tec27): We need a UNIQUE index to be able to refresh concurrently
  await db.runSql(`
    CREATE UNIQUE INDEX ranked_matchmaking_ratings_view_user_id
    ON ranked_matchmaking_ratings_view (user_id, matchmaking_type)
  `)
  await db.runSql(`
    CREATE INDEX ranked_matchmaking_ratings_view_rank
    ON ranked_matchmaking_ratings_view (matchmaking_type, rank)
  `)
}

exports.down = async function (db) {
  await db.runSql(`DROP MATERIALIZED VIEW ranked_matchmaking_ratings_view`)

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
    CREATE INDEX ranked_matchmaking_ratings_view_rank
    ON ranked_matchmaking_ratings_view (rank)
  `)
}

exports._meta = {
  version: 1,
}
