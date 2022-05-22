exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE matchmaking_ratings
    ADD COLUMN points real DEFAULT 0,
    ADD COLUMN bonus_used real DEFAULT 0;
  `)
  await db.runSql(`
    ALTER TABLE matchmaking_rating_changes
    ADD COLUMN points real DEFAULT 0,
    ADD COLUMN points_change real DEFAULT 0,
    ADD COLUMN bonus_used real DEFAULT 0,
    ADD COLUMN bonus_used_change real DEFAULT 0;
  `)

  // Simple hack to make sure the new rating view code doesn't have to worry about this, for legacy
  // seasons we just treat the rating and points as identical values (and never have a bonus).
  await db.runSql(`
    UPDATE matchmaking_ratings AS mr
    SET points = mr.rating
    FROM matchmaking_seasons ms
    WHERE mr.season_id = ms.id AND ms.use_legacy_rating = TRUE;
  `)
  // Note that the matchmaking_ratings_changes table won't necessarily be correct for legacy seasons
  // that have data before this migration + code changes, but it doesn't really feel worth the
  // effort to fix at the moment (at worst it just makes the match history's view into changes a
  // bit off, but those games will quickly become irrelevant).

  await db.runSql(`
    CREATE INDEX matchmaking_ratings_points
    ON matchmaking_ratings (season_id, matchmaking_type, points DESC);
  `)
  // This index never got updated to be partitioned by matchmaking_type anyway apparently?
  await db.runSql(`
    DROP INDEX matchmaking_ratings_rating;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE matchmaking_ratings
    DROP COLUMN points,
    DROP COLUMN bonus_used;
  `)
  await db.runSql(`
    ALTER TABLE matchmaking_rating_changes
    DROP COLUMN points,
    DROP COLUMN points_change,
    DROP COLUMN bonus_used,
    DROP COLUMN bonus_used_change;
  `)

  await db.runSql(`
    CREATE INDEX matchmaking_ratings_rating ON matchmaking_ratings (rating DESC);
  `)
}

exports._meta = {
  version: 1,
}
