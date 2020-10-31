exports.up = async function (db) {
  await db.runSql(`
    CREATE TABLE matchmaking_times (
      id serial PRIMARY KEY,
      matchmaking_type matchmaking_type NOT NULL,
      start_date timestamp without time zone NOT NULL,
      enabled boolean NOT NULL
    );
  `)

  await db.runSql(`
    ALTER TABLE permissions
    ADD COLUMN manage_matchmaking_times boolean NOT NULL DEFAULT false;
  `)
}

exports.down = async function (db) {
  await db.dropTable('matchmaking_times')
  await db.runSql(`
    ALTER TABLE permissions
    DROP COLUMN manage_matchmaking_times;
  `)
}

exports._meta = {
  version: 1,
}
