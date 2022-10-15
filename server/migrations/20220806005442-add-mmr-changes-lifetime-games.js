exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE matchmaking_rating_changes
    ADD COLUMN lifetime_games integer DEFAULT 0;
  `)
  // NOTE(tec27): Not likely to be a correct value for old changes, but shouldn't cause issues and
  // is *much* easier to migrate to. Will be correct for changes that are made after this migration
  await db.runSql(`
    UPDATE matchmaking_rating_changes
    SET lifetime_games = mmr.lifetime_games
    FROM (
      SELECT DISTINCT ON (user_id) user_id, lifetime_games
      FROM matchmaking_ratings mmr
      ORDER BY user_id, last_played_date DESC
    ) AS mmr
    WHERE mmr.user_id = matchmaking_rating_changes.user_id
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE matchmaking_rating_changes
    DROP COLUMN lifetime_games;
  `)
}

exports._meta = {
  version: 1,
}
