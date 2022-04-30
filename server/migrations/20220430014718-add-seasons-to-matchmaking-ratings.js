exports.up = async function (db) {
  // First we create the columns as nullable since we can't guarantee what the right season ID is
  await db.runSql(`
    ALTER TABLE matchmaking_ratings
    ADD COLUMN season_id integer;
  `)

  // Then we update all the rows to have the latest season ID
  await db.runSql(`
    UPDATE matchmaking_ratings
    SET season_id = (SELECT id FROM matchmaking_seasons ORDER BY start_date DESC LIMIT 1);
  `)

  // Then we make them non-nullable
  await db.runSql(`
    ALTER TABLE matchmaking_ratings
    ALTER COLUMN season_id SET NOT NULL;
  `)

  // Finally, we update the primary keys for matchmaking_rating to include the season ID
  await db.runSql(`
    ALTER TABLE matchmaking_ratings
    DROP CONSTRAINT matchmaking_ratings_pkey,
    ADD PRIMARY KEY (user_id, matchmaking_type, season_id);
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE matchmaking_ratings
    DROP CONSTRAINT matchmaking_ratings_pkey,
    ADD PRIMARY KEY (user_id, matchmaking_type);
  `)

  await db.runSql(`
    ALTER TABLE matchmaking_ratings
    DROP COLUMN season_id;
  `)
}

exports._meta = {
  version: 1,
}
