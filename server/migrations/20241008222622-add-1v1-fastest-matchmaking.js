exports.up = async function (db) {
  await db.runSql(`ALTER TYPE matchmaking_type ADD VALUE IF NOT EXISTS '1v1fastest';`)
}

exports.down = async function (db) {
  // NOTE(tec27): The down migration for this would be extremely complex relative to the up, and not
  // really worth maintaining. Should just avoid ever undoing this
}

exports._meta = {
  version: 1,
}
