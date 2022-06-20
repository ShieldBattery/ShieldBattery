exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE matchmaking_ratings
    ADD COLUMN lifetime_games integer DEFAULT 0;
  `)
  // NOTE(tec27): Not a necessarily correct value for devs who have consecutive non-reset seasons,
  // but will be correct on production servers. (Shouldn't matter much locally, just means people
  // might count as "in placements" when they technically shouldn't be)
  await db.runSql(`
    UPDATE matchmaking_ratings
    SET lifetime_games = wins + losses;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE matchmaking_ratings
    DROP COLUMN lifetime_games;
  `)
}

exports._meta = {
  version: 1,
}
