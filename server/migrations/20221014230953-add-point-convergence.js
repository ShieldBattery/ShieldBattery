exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE matchmaking_ratings
    ADD COLUMN points_converged boolean DEFAULT FALSE;
  `)
  await db.runSql(`
    ALTER TABLE matchmaking_rating_changes
    ADD COLUMN points_converged boolean DEFAULT FALSE;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE matchmaking_ratings
    DROP COLUMN points_converged;
  `)
  await db.runSql(`
    ALTER TABLE matchmaking_rating_changes
    DROP COLUMN points_converged;
  `)
}

exports._meta = {
  version: 1,
}
