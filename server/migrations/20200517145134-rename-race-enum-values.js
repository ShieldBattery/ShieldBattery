// NOTE(tec27): This migration was checked in before we realized it required superuser DB access to
// run. Since it was already checked in, I've left the file here to make it easy to find history
// for, but the "real" form of this migration is the one following this.
exports.up = async function (db) {}

exports.down = async function (db) {}

exports._meta = {
  version: 1,
}
