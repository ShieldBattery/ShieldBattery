exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE matchmaking_seasons
    DROP COLUMN use_legacy_rating;
  `)

  await db.runSql(`
    ALTER TABLE matchmaking_ratings
    DROP COLUMN k_factor,
    DROP COLUMN unexpected_streak;
  `)

  await db.runSql(`
    ALTER TABLE matchmaking_rating_changes
    DROP COLUMN k_factor,
    DROP COLUMN k_factor_change,
    DROP COLUMN unexpected_streak;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE matchmaking_seasons
    ADD COLUMN use_legacy_rating boolean NOT NULL DEFAULT false;
  `)

  await db.runSql(`
    ALTER TABLE matchmaking_ratings
    ADD COLUMN k_factor real NOT NULL DEFAULT 24,
    ADD COLUMN unexpected_streak smallint NOT NULL DEFAULT 0;
  `)

  await db.runSql(`
    ALTER TABLE matchmaking_rating_changes
    ADD COLUMN k_factor real NOT NULL DEFAULT 24,
    ADD COLUMN k_factor_change real NOT NULL DEFAULT 0,
    ADD COLUMN unexpected_streak smallint NOT NULL DEFAULT 0;
  `)
}

exports._meta = {
  version: 1,
}
