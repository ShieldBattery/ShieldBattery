exports.up = async function(db) {
  await db.runSql(`
    CREATE TYPE map_visibility
    AS ENUM ('OFFICIAL', 'PRIVATE', 'PUBLIC');
  `)
}

exports.down = async function(db) {
  await db.runSql('DROP TYPE map_visibility;')
}

exports._meta = {
  version: 1,
}
