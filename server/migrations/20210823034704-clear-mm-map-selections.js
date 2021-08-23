const sql = require('sql-template-strings')

// NOTE(tec27): We're clearing these because we've changed the meaning of this column for. It used
// to mean the map was preferred, now it means that the map is vetoed. This applies to all
// currently available matchmaking types, so we don't check for that specifically.
exports.up = async function (db) {
  await db.runSql(sql`
    UPDATE matchmaking_preferences
    SET map_selections = ${[]}
  `)
}

exports.down = async function (db) {
  // can't really be undone D:
}

exports._meta = {
  version: 1,
}
