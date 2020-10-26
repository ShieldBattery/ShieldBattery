exports.up = async function (db) {
  // NOTE(tec27): We've never shipped a version of SB that really uses game results stuff yet, so
  // I consider this "safe" to do, and it means we don't have to deal with non-standard JSON formats
  // or attempt a migration of the data
  await db.runSql(`
    TRUNCATE games, games_users;
  `)

  await db.runSql(`
    ALTER TABLE games
    ADD COLUMN results jsonb NULL;
  `)

  await db.runSql(`
    ALTER TABLE games_users
    ADD COLUMN apm integer NULL;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE games_users
    DROP COLUMN apm;
  `)

  await db.runSql(`
    ALTER TABLE games
    DROP COLUMN results;
  `)
}

exports._meta = {
  version: 1,
}
