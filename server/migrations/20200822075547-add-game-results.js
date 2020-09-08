exports.up = async function (db) {
  await db.runSql(`
    CREATE TABLE games (
      id uuid NOT NULL,
      start_time timestamp without time zone NOT NULL,
      map_id uuid NOT NULL,
      disputable boolean NOT NULL,
      dispute_requested boolean NOT NULL,
      dispute_reviewed boolean NOT NULL,
      game_length integer NULL,

      PRIMARY KEY (id)
    );
  `)

  await db.runSql(`
    CREATE TYPE game_result AS ENUM ('unknown', 'draw', 'loss', 'win');
  `)

  await db.runSql(`
      CREATE TABLE games_users (
        user_id integer NOT NULL,
        game_id uuid NOT NULL,
        start_time timestamp without time zone NOT NULL,
        selected_race race NOT NULL,
        result_code varchar(50) NOT NULL,
        reported_results jsonb NULL,
        reported_at timestamp without time zone NULL,
        assigned_race race NULL,
        result game_result NULL,

        PRIMARY KEY (user_id, game_id)
      );
  `)

  // The composite primary key will already be used to speed up queries on just user_id, but we
  // want to be able to query by just game_id quickly as well
  await db.runSql(`
    CREATE INDEX games_users_game_id_index ON games_users (game_id);
  `)
}

exports.down = async function (db) {
  await db.dropTable('games_users')
  await db.dropTable('games')
  await db.runSql('DROP TYPE game_result;')
}

exports._meta = {
  version: 1,
}
