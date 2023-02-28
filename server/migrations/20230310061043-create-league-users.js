exports.up = async function (db) {
  await db.runSql(`
    CREATE TABLE league_users (
      league_id uuid NOT NULL,
      user_id integer NOT NULL,
      last_played_date timestamp without time zone,

      points real NOT NULL DEFAULT 0,
      points_converged boolean NOT NULL DEFAULT false,

      wins integer NOT NULL DEFAULT 0,
      losses integer NOT NULL DEFAULT 0,
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
      r_z_losses integer NOT NULL DEFAULT 0,

      PRIMARY KEY (league_id, user_id),
      FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `)

  await db.runSql(`
      CREATE INDEX ON league_users(user_id);
  `)

  await db.runSql(`
      CREATE TABLE league_user_changes (
        user_id integer NOT NULL,
        league_id uuid NOT NULL,
        game_id uuid NOT NULL,
        change_date timestamp without time zone NOT NULL,

        outcome matchmaking_result NOT NULL,
        points real NOT NULL,
        points_change real NOT NULL,
        points_converged boolean NOT NULL,

        PRIMARY KEY (user_id, league_id, game_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE,
        FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
      );
  `)

  await db.runSql(`
      CREATE INDEX ON league_user_changes(user_id);
  `)
  await db.runSql(`
      CREATE INDEX ON league_user_changes(game_id);
  `)
}

exports.down = async function (db) {
  await db.runSql(`DROP TABLE league_user_changes;`)
  await db.runSql(`DROP TABLE league_users;`)
}

exports._meta = {
  version: 1,
}
