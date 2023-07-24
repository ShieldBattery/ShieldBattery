exports.up = async function (db) {
  await db.runSql(`
   UPDATE users
   SET locale = 'ko'
   WHERE locale = 'kr';
  `)
}

exports.down = async function (_db) {
  // Nothing to undo, the previous language code was just wrong
}

exports._meta = {
  version: 1,
}
