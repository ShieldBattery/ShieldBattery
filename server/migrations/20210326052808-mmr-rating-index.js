exports.up = async function (db) {
  await db.runSql(`
    CREATE INDEX matchmaking_ratings_rating ON matchmaking_ratings (rating DESC);
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    DROP INDEX matchmaking_ratings_rating;
  `)
}

exports._meta = {
  version: 1,
}
