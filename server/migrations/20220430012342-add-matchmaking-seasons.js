exports.up = async function (db) {
  await db.runSql(`
    CREATE TABLE matchmaking_seasons (
      id serial PRIMARY KEY,
      start_date timestamp without time zone NOT NULL,
      name text NOT NULL,
      use_legacy_rating boolean NOT NULL DEFAULT false
    );
  `)

  await db.runSql(`
    CREATE INDEX matchmaking_seasons_start_date_index ON matchmaking_seasons (start_date DESC);
  `)

  await db.runSql(`
    ALTER TABLE permissions
    ADD COLUMN manage_matchmaking_seasons boolean NOT NULL DEFAULT false;
  `)

  await db.runSql(`
      INSERT INTO matchmaking_seasons (start_date, name, use_legacy_rating)
      VALUES (
        TO_TIMESTAMP('2012-01-01', 'YYYY-MM-DD') AT TIME ZONE 'UTC',
        'Beta Season',
        true
      );
  `)
}

exports.down = async function (db) {
  await db.dropTable('matchmaking_seasons')
  await db.runSql(`
    ALTER TABLE permissions
    DROP COLUMN manage_matchmaking_seasons;
  `)
}

exports._meta = {
  version: 1,
}
