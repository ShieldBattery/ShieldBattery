// Due to matchmaking preferences being saved for each matchmaking type and user combination, we add
// the `updated_at` property so we can easily determine which preferences were updated last. The one
// that was updated last will be used as a currently "active" matchmaking type, and their
// preferences will be fetched when preferences for no specific matchmaking type were requested.
exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE matchmaking_preferences
    ADD COLUMN use_alternate_race boolean,
    ADD COLUMN updated_at timestamp without time zone;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE matchmaking_preferences
    DROP COLUMN use_alternate_race,
    DROP COLUMN updated_at;
  `)
}

exports._meta = {
  version: 1,
}
