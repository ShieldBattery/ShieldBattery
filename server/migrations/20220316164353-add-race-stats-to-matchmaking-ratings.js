exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE matchmaking_ratings

    ADD COLUMN p_wins integer NOT NULL DEFAULT 0,
    ADD COLUMN p_losses integer NOT NULL DEFAULT 0,

    ADD COLUMN t_wins integer NOT NULL DEFAULT 0,
    ADD COLUMN t_losses integer NOT NULL DEFAULT 0,

    ADD COLUMN z_wins integer NOT NULL DEFAULT 0,
    ADD COLUMN z_losses integer NOT NULL DEFAULT 0,

    ADD COLUMN r_wins integer NOT NULL DEFAULT 0,
    ADD COLUMN r_losses integer NOT NULL DEFAULT 0,

    ADD COLUMN r_p_wins integer NOT NULL DEFAULT 0,
    ADD COLUMN r_p_losses integer NOT NULL DEFAULT 0,

    ADD COLUMN r_t_wins integer NOT NULL DEFAULT 0,
    ADD COLUMN r_t_losses integer NOT NULL DEFAULT 0,

    ADD COLUMN r_z_wins integer NOT NULL DEFAULT 0,
    ADD COLUMN r_z_losses integer NOT NULL DEFAULT 0;
  `)

  // Populate wins/losses for each race for each user
  for (const race of ['p', 't', 'z', 'r']) {
    await db.runSql(`
      UPDATE matchmaking_ratings AS s
      SET ${race}_wins = r.wins
      FROM (
        SELECT user_id, g.config->'gameSourceExtra'->>'type' as matchmaking_type, COUNT(*) as wins
        FROM games_users gu JOIN games g
          ON gu.game_id = g.id
        WHERE
          g.config->>'gameSource' = 'MATCHMAKING' AND
          gu.selected_race = '${race}' AND
          gu.result = 'win'
        GROUP BY user_id, matchmaking_type
      ) r
      WHERE s.user_id = r.user_id AND s.matchmaking_type = r.matchmaking_type::matchmaking_type
    `)

    await db.runSql(`
      UPDATE matchmaking_ratings AS s
      SET ${race}_losses = r.losses
      FROM (
        SELECT user_id, g.config->'gameSourceExtra'->>'type' as matchmaking_type, COUNT(*) as losses
        FROM games_users gu JOIN games g
          ON gu.game_id = g.id
        WHERE
          g.config->>'gameSource' = 'MATCHMAKING' AND
          gu.selected_race = '${race}' AND
          gu.result = 'loss'
        GROUP BY user_id, matchmaking_type
      ) r
      WHERE s.user_id = r.user_id AND s.matchmaking_type = r.matchmaking_type::matchmaking_type
    `)
  }

  // Populate wins/losses for each assigned random race for each user
  for (const race of ['p', 't', 'z']) {
    await db.runSql(`
      UPDATE matchmaking_ratings AS s
      SET r_${race}_wins = r.wins
      FROM (
        SELECT user_id, g.config->'gameSourceExtra'->>'type' as matchmaking_type, COUNT(*) as wins
        FROM games_users gu JOIN games g
          ON gu.game_id = g.id
        WHERE
          g.config->>'gameSource' = 'MATCHMAKING' AND
          gu.selected_race = 'r' AND
          gu.assigned_race = '${race}' AND
          gu.result = 'win'
        GROUP BY user_id, matchmaking_type
      ) r
      WHERE s.user_id = r.user_id AND s.matchmaking_type = r.matchmaking_type::matchmaking_type
    `)

    await db.runSql(`
      UPDATE matchmaking_ratings AS s
      SET r_${race}_losses = r.losses
      FROM (
        SELECT user_id, g.config->'gameSourceExtra'->>'type' as matchmaking_type, COUNT(*) as losses
        FROM games_users gu JOIN games g
          ON gu.game_id = g.id
        WHERE
          g.config->>'gameSource' = 'MATCHMAKING' AND
          gu.selected_race = 'r' AND
          gu.assigned_race = '${race}' AND
          gu.result = 'loss'
        GROUP BY user_id, matchmaking_type
      ) r
      WHERE s.user_id = r.user_id AND s.matchmaking_type = r.matchmaking_type::matchmaking_type
    `)
  }

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
      r.user_id, r.matchmaking_type, r.rating, r.wins, r.losses, r.last_played_date
    FROM matchmaking_ratings r
    WHERE r.num_games_played > 0;
  `)

  // NOTE(2Pac): We can't create a UNIQUE index here anymore, because the `user_id` might not be
  // unique.
  await db.runSql(`
    CREATE INDEX ranked_matchmaking_ratings_view_user_id
    ON ranked_matchmaking_ratings_view (user_id);
  `)
  await db.runSql(`
    CREATE INDEX ranked_matchmaking_ratings_view_rank
    ON ranked_matchmaking_ratings_view (rank);
  `)

  await db.runSql(`
    ALTER TABLE matchmaking_ratings

    DROP COLUMN p_wins,
    DROP COLUMN p_losses,

    DROP COLUMN t_wins,
    DROP COLUMN t_losses,

    DROP COLUMN z_wins,
    DROP COLUMN z_losses,

    DROP COLUMN r_wins,
    DROP COLUMN r_losses,

    DROP COLUMN r_p_wins,
    DROP COLUMN r_p_losses,

    DROP COLUMN r_t_wins,
    DROP COLUMN r_t_losses,

    DROP COLUMN r_z_wins,
    DROP COLUMN r_z_losses;
  `)
}

exports._meta = {
  version: 1,
}
