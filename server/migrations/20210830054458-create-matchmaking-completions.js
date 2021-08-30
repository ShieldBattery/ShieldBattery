exports.up = async function (db) {
  await db.runSql(`
    CREATE TYPE matchmaking_completion_type AS ENUM ('found', 'cancel', 'disconnect');
  `)

  await db.runSql(`
    CREATE TABLE matchmaking_completions (
      id uuid NOT NULL DEFAULT uuid_generate_v4(),
      user_id integer NOT NULL,
      matchmaking_type matchmaking_type NOT NULL,
      completion_type matchmaking_completion_type NOT NULL,
      search_time_millis integer NOT NULL,
      completion_time timestamp without time zone NOT NULL DEFAULT timezone('utc', now()),

      PRIMARY KEY (id)
    );
  `)

  await db.runSql(`
      CREATE INDEX matchmaking_completions_user_id_index ON matchmaking_completions (user_id)
  `)

  // NOTE(tec27): There are probably other indexes here that would be useful, but we can wait til
  // we know how we're using the data to add them.
}

exports.down = async function (db) {
  await db.dropTable('matchmaking_completions')
  await db.runSql('DROP TYPE matchmaking_completion_type;')
}

exports._meta = {
  version: 1,
}
