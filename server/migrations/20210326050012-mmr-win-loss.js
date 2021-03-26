exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE matchmaking_ratings
    ADD COLUMN wins integer DEFAULT 0;
  `)
  await db.runSql(`
    ALTER TABLE matchmaking_ratings
    ADD COLUMN losses integer DEFAULT 0;
  `)

  // Migrate existing users. Sort of a hack to avoid needing to query into game results at all.
  await db.runSql(`
    UPDATE matchmaking_ratings r
    SET wins = c.wins
    FROM (
      SELECT user_id, COUNT(*) AS wins
      FROM matchmaking_rating_changes
      WHERE outcome = 'win'
      GROUP BY user_id
    ) c
    WHERE r.user_id = c.user_id;
  `)
  await db.runSql(`
    UPDATE matchmaking_ratings r
    SET losses = c.losses
    FROM (
      SELECT user_id, COUNT(*) AS losses
      FROM matchmaking_rating_changes
      WHERE outcome = 'loss'
      GROUP BY user_id
    ) c
    WHERE r.user_id = c.user_id;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE matchmaking_ratings
    DROP COLUMN losses;
  `)
  await db.runSql(`
    ALTER TABLE matchmaking_ratings
    DROP COLUMN wins;
  `)
}

exports._meta = {
  version: 1,
}
