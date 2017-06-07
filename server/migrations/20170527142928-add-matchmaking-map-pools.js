exports.up = async function(db) {
  await db.runSql(`
      ALTER TABLE permissions
      ADD COLUMN manage_map_pools boolean NOT NULL DEFAULT false;
  `)

  await db.runSql(`
    CREATE TABLE matchmaking_map_pools (
      id serial PRIMARY KEY,
      matchmaking_type matchmaking_type NOT NULL,
      start_date timestamp without time zone NOT NULL,
      maps bytea[] NOT NULL
    );
  `)
}

exports.down = async function(db) {
  await db.runSql('ALTER TABLE permissions DROP COLUMN manage_map_pools;')
  await db.runSql('DROP TABLE matchmaking_map_pools;')
}

exports._meta = {
  version: 1
}
