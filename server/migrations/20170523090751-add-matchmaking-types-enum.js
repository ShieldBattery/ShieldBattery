exports.up = async function(db) {
  await db.runSql(`
    CREATE TYPE matchmaking_type AS ENUM ('1v1');
  `)
}

exports.down = async function(db) {
  await db.runSql('DROP TYPE matchmaking_type;')
}

exports._meta = {
  version: 1
}
