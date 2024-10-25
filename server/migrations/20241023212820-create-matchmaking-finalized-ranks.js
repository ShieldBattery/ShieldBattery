exports.up = async function (db) {
  // Create a table to hold the finalized ranks for each season, with the primary key being the
  // composite value of (season_id, matchmaking_type, user_id)
  await db.runSql(`
    CREATE TABLE matchmaking_finalized_ranks (
      season_id integer REFERENCES matchmaking_seasons(id) ON DELETE CASCADE,
      matchmaking_type matchmaking_type NOT NULL,
      user_id integer REFERENCES users(id) ON DELETE CASCADE,
      rank integer NOT NULL,

      PRIMARY KEY (season_id, matchmaking_type, user_id)
    );
  `)

  // Create an index on the table to make it faster to order by rank
  await db.runSql(`
    CREATE INDEX matchmaking_finalized_ranks_rank
    ON matchmaking_finalized_ranks (season_id, matchmaking_type, rank);
  `)
}

exports.down = async function (db) {
  await db.runSql(`DROP TABLE matchmaking_finalized_ranks;`)
}

exports._meta = {
  version: 1,
}
