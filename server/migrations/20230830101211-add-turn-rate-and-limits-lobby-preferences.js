exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE lobby_preferences
    ADD COLUMN turn_rate integer,
    ADD COLUMN use_legacy_limits boolean;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE lobby_preferences
    DROP COLUMN turn_rate,
    DROP COLUMN use_legacy_limits;
  `)
}

exports._meta = {
  version: 1,
}
