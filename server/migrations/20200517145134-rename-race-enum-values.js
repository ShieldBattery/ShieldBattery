// NOTE(tec27): The reasoning for this migration was not well-founded and it caused or would cause
// a number of problems throughout the app, so it has been removed. The original migration also
// failed to run if you were not a superuser, so for most users this migration never would have run
// at all. Thus, instead of checking in a rollback migration, I've simply removed the contents. The
// file is in place so that its history can be easily found if someone *did* run the migration, and
// they can check out a previous version to roll it back.
exports.up = async function (db) {}

exports.down = async function (db) {}

exports._meta = {
  version: 1,
}
