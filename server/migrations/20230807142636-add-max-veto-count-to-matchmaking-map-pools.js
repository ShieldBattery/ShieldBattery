exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE matchmaking_map_pools
    ADD COLUMN max_veto_count integer NOT NULL DEFAULT 3;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE matchmaking_map_pools
    DROP COLUMN max_veto_count;
  `)
}

exports._meta = {
  version: 1,
}
