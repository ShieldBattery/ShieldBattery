exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE matchmaking_seasons
    ADD COLUMN reset_mmr boolean NOT NULL DEFAULT false;
  `)

  // We don't have handling for maintaining MMR prior to this change so existing seasons should
  // be set to reset it
  await db.runSql(`
    UPDATE matchmaking_seasons
    SET reset_mmr = true;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE matchmaking_seasons
    DROP COLUMN reset_mmr;
  `)
}

exports._meta = {
  version: 1,
}
