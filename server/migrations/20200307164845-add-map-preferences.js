exports.up = async function (db) {
  await db.runSql(`
    CREATE TABLE map_preferences (
      user_id integer PRIMARY KEY,
      visibility map_visibility,
      thumbnail_size integer,
      sort_option integer,
      num_players_filter integer[],
      tileset_filter integer[]
    );
  `)
}

exports.down = async function (db) {
  await db.runSql('DROP TABLE map_preferences')
}

exports._meta = {
  version: 1,
}
