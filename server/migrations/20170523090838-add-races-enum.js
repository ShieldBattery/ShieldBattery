exports.up = async function(db) {
  await db.runSql(`
    CREATE TYPE race AS ENUM ('zerg', 'terran', 'protoss', 'random');
  `)
}

exports.down = async function(db) {
  await db.runSql('DROP TYPE race;')
}

exports._meta = {
  version: 1,
}
