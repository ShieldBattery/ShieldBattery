exports.up = async function(db) {
  await db.runSql(`
    CREATE TABLE lobby_preferences (
      user_id integer PRIMARY KEY,
      name varchar(50),
      game_type game_type,
      game_sub_type integer,
      recent_maps bytea[],
      selected_map bytea
    );
  `)
}

exports.down = async function(db) {
  await db.runSql('DROP TABLE lobby_preferences')
}

exports._meta = {
  version: 1,
}
