exports.up = async function (db) {
  await db.runSql(`
    DROP MATERIALIZED VIEW ranked_matchmaking_ratings_view;
  `)

  // TODO(tec27): The subquery seems potentially wasteful here but it's hard for me to get a good
  // read on tha with the amount of data I have locally. With the plans generated there
  // (admittedly probably different than the 'real' ones), doing this is less expensive than adding
  // a single WITH to select the current season first, but we should probably look at it on the
  // real server when this has been deployed
  await db.runSql(`
    CREATE MATERIALIZED VIEW ranked_matchmaking_ratings_view AS
    SELECT RANK() OVER (
        PARTITION BY r.matchmaking_type
        ORDER BY r.rating DESC
      ) as rank,
      r.user_id, r.matchmaking_type, r.rating, r.wins, r.losses, r.p_wins, r.p_losses, r.t_wins,
      r.t_losses, r.z_wins, r.z_losses, r.r_wins, r.r_losses, r.r_p_wins, r.r_p_losses, r.r_t_wins,
      r.r_t_losses, r.r_z_wins, r.r_z_losses, r.last_played_date
    FROM matchmaking_ratings r
    WHERE r.num_games_played > 0
    AND r.season_id = (
      SELECT id from matchmaking_seasons
      WHERE start_date <= NOW()
      ORDER BY start_date DESC
      LIMIT 1
    );
  `)

  // NOTE(tec27): We need a UNIQUE index to be able to refresh concurrently
  await db.runSql(`
    CREATE UNIQUE INDEX ranked_matchmaking_ratings_view_user_id
    ON ranked_matchmaking_ratings_view (user_id, matchmaking_type);
  `)
  await db.runSql(`
    CREATE INDEX ranked_matchmaking_ratings_view_rank
    ON ranked_matchmaking_ratings_view (matchmaking_type, rank);
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    DROP MATERIALIZED VIEW ranked_matchmaking_ratings_view;
  `)

  await db.runSql(`
    CREATE MATERIALIZED VIEW ranked_matchmaking_ratings_view AS
    SELECT RANK() OVER (
        PARTITION BY r.matchmaking_type
        ORDER BY r.rating DESC
      ) as rank,
      r.user_id, r.matchmaking_type, r.rating, r.wins, r.losses, r.p_wins, r.p_losses, r.t_wins,
      r.t_losses, r.z_wins, r.z_losses, r.r_wins, r.r_losses, r.r_p_wins, r.r_p_losses, r.r_t_wins,
      r.r_t_losses, r.r_z_wins, r.r_z_losses, r.last_played_date
    FROM matchmaking_ratings r
    WHERE r.num_games_played > 0;
  `)

  // NOTE(tec27): We need a UNIQUE index to be able to refresh concurrently
  await db.runSql(`
    CREATE UNIQUE INDEX ranked_matchmaking_ratings_view_user_id
    ON ranked_matchmaking_ratings_view (user_id, matchmaking_type);
  `)
  await db.runSql(`
    CREATE INDEX ranked_matchmaking_ratings_view_rank
    ON ranked_matchmaking_ratings_view (matchmaking_type, rank);
  `)
}

exports._meta = {
  version: 1,
}
