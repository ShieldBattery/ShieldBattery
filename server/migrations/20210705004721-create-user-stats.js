exports.up = async function (db) {
  await db.runSql(`
    CREATE TABLE user_stats (
      user_id integer PRIMARY KEY,

      p_wins integer NOT NULL DEFAULT 0,
      p_losses integer NOT NULL DEFAULT 0,

      t_wins integer NOT NULL DEFAULT 0,
      t_losses integer NOT NULL DEFAULT 0,

      z_wins integer NOT NULL DEFAULT 0,
      z_losses integer NOT NULL DEFAULT 0,

      r_wins integer NOT NULL DEFAULT 0,
      r_losses integer NOT NULL DEFAULT 0,

      r_p_wins integer NOT NULL DEFAULT 0,
      r_p_losses integer NOT NULL DEFAULT 0,

      r_t_wins integer NOT NULL DEFAULT 0,
      r_t_losses integer NOT NULL DEFAULT 0,

      r_z_wins integer NOT NULL DEFAULT 0,
      r_z_losses integer NOT NULL DEFAULT 0
    );
  `)

  // Populate a row for each user into user_stats, whether or not they've played a game
  await db.runSql(`
    INSERT INTO user_stats
    SELECT u.id as user_id
    FROM users u
  `)

  // Populate wins/losses for each race for each user
  for (const race of ['p', 't', 'z', 'r']) {
    await db.runSql(`
      UPDATE user_stats AS s
      SET ${race}_wins = r.wins
      FROM (
        SELECT user_id, COUNT(*) as wins
        FROM games_users gu JOIN games g
          ON gu.game_id = g.id
        WHERE
          g.config->>'gameType' != 'ums' AND
          gu.selected_race = '${race}' AND
          gu.result = 'win'
        GROUP BY user_id
      ) r
      WHERE s.user_id = r.user_id
    `)

    await db.runSql(`
      UPDATE user_stats AS s
      SET ${race}_losses = r.losses
      FROM (
        SELECT user_id, COUNT(*) as losses
        FROM games_users gu JOIN games g
          ON gu.game_id = g.id
        WHERE
          g.config->>'gameType' != 'ums' AND
          gu.selected_race = '${race}' AND
          gu.result = 'loss'
        GROUP BY user_id
      ) r
      WHERE s.user_id = r.user_id
    `)
  }

  // Populate wins/losses for each assigned random race for each user
  for (const race of ['p', 't', 'z']) {
    await db.runSql(`
      UPDATE user_stats AS s
      SET r_${race}_wins = r.wins
      FROM (
        SELECT user_id, COUNT(*) as wins
        FROM games_users gu JOIN games g
          ON gu.game_id = g.id
        WHERE
          g.config->>'gameType' != 'ums' AND
          gu.assigned_race = '${race}' AND
          gu.result = 'win'
        GROUP BY user_id
      ) r
      WHERE s.user_id = r.user_id
    `)

    await db.runSql(`
      UPDATE user_stats AS s
      SET r_${race}_losses = r.losses
      FROM (
        SELECT user_id, COUNT(*) as losses
        FROM games_users gu JOIN games g
          ON gu.game_id = g.id
        WHERE
          g.config->>'gameType' != 'ums' AND
          gu.assigned_race = '${race}' AND
          gu.result = 'loss'
        GROUP BY user_id
      ) r
      WHERE s.user_id = r.user_id
    `)
  }
}

exports.down = async function (db) {
  await db.dropTable('user_stats')
}

exports._meta = {
  version: 1,
}
