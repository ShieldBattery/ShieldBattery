exports.up = async function(db) {
  await db.runSql(`CREATE TABLE matchmaking_preferences (
      user_id integer NOT NULL,
      matchmaking_type matchmaking_type NOT NULL,
      race race NOT NULL,
      alternate_race race,
      map_pool_id integer NOT NULL,
      preferred_maps bytea[],
      PRIMARY KEY (user_id, matchmaking_type)
    );
  `)
}

exports.down = async function(db) {
  await db.runSql('DROP TABLE matchmaking_preferences')
}

exports._meta = {
  version: 1,
}
