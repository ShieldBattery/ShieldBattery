exports.up = async function (db) {
  await db.runSql(`
    CREATE TYPE game_type
    AS ENUM ('melee', 'ffa', 'topVBottom', 'teamMelee', 'teamFfa', 'ums', 'oneVOne');
  `)
}

exports.down = async function (db) {
  await db.runSql('DROP TYPE game_type;')
}

exports._meta = {
  version: 1,
}
