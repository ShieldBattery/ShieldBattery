exports.up = async function (db) {
  await db.runSql(`
    CREATE TABLE matchmaking_ratings (
      user_id integer NOT NULL,
      matchmaking_type matchmaking_type NOT NULL,
      rating real NOT NULL,
      k_factor real NOT NULL,
      uncertainty real NOT NULL,
      unexpected_streak smallint NOT NULL,
      num_games_played integer NOT NULL,
      last_played_date timestamp without time zone NOT NULL,

      PRIMARY KEY (user_id, matchmaking_type)
    );
  `)

  await db.runSql(`
      CREATE TYPE matchmaking_result AS ENUM ('loss', 'win');
  `)

  await db.runSql(`
    CREATE TABLE matchmaking_rating_changes (
      user_id integer NOT NULL,
      matchmaking_type matchmaking_type NOT NULL,
      game_id uuid NOT NULL,
      change_date timestamp without time zone NOT NULL,

      outcome matchmaking_result NOT NULL,
      rating real NOT NULL,
      rating_change real NOT NULL,
      k_factor real NOT NULL,
      k_factor_change real NOT NULL,
      uncertainty real NOT NULL,
      uncertainty_change real NOT NULL,
      probability real NOT NULL,
      unexpected_streak smallint NOT NULL,

      PRIMARY KEY (user_id, matchmaking_type, game_id)
    );
  `)
  await db.runSql(`
    CREATE INDEX change_date_index ON matchmaking_rating_changes (change_date DESC);
  `)
}

exports.down = async function (db) {
  await db.dropTable('matchmaking_rating_changes')
  await db.runSql('DROP TYPE matchmaking_result;')
  await db.dropTable('matchmaking_ratings')
}

exports._meta = {
  version: 1,
}
