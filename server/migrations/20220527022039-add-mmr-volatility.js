exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE matchmaking_ratings
    ADD COLUMN volatility real DEFAULT 0;
  `)
  await db.runSql(`
    ALTER TABLE matchmaking_rating_changes
    ADD COLUMN volatility real DEFAULT 0,
    ADD COLUMN volatility_change real DEFAULT 0;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE matchmaking_ratings
    DROP COLUMN volatility;
  `)
  await db.runSql(`
    ALTER TABLE matchmaking_rating_changes
    DROP COLUMN volatility,
    DROP COLUMN volatility_change;
  `)
}

exports._meta = {
  version: 1,
}
