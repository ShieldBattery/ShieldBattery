exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE leagues
    ADD COLUMN matchmaking_type matchmaking_type;
  `)

  // Set existing leagues to 1v1 (safe because the previous migrations/code to insert these has
  // not be pushed to the repo yet)
  await db.runSql(`
    UPDATE leagues
    SET matchmaking_type = '1v1';
  `)

  // Make the column non-null
  await db.runSql(`
    ALTER TABLE leagues
    ALTER COLUMN matchmaking_type SET NOT NULL;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE leagues
    DROP COLUMN matchmaking_type;
  `)
}

exports._meta = {
  version: 1,
}
