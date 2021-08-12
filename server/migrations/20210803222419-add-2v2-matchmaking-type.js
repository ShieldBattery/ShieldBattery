exports.up = async function (db) {
  await db.runSql(`ALTER TYPE matchmaking_type RENAME TO matchmaking_type_old;`)
  await db.runSql(`CREATE TYPE matchmaking_type AS ENUM ('1v1', '2v2');`)

  await db.runSql(`
    ALTER TABLE matchmaking_map_pools
    ALTER COLUMN matchmaking_type
      TYPE matchmaking_type
      USING matchmaking_type::TEXT::matchmaking_type;
  `)
  await db.runSql(`
    ALTER TABLE matchmaking_preferences
    ALTER COLUMN matchmaking_type
      TYPE matchmaking_type
      USING matchmaking_type::TEXT::matchmaking_type;
  `)
  await db.runSql(`
    ALTER TABLE matchmaking_rating_changes
    ALTER COLUMN matchmaking_type
      TYPE matchmaking_type
      USING matchmaking_type::TEXT::matchmaking_type;
  `)
  await db.runSql(`
    ALTER TABLE matchmaking_ratings
    ALTER COLUMN matchmaking_type
      TYPE matchmaking_type
      USING matchmaking_type::TEXT::matchmaking_type;
  `)
  await db.runSql(`
    ALTER TABLE matchmaking_times
    ALTER COLUMN matchmaking_type
      TYPE matchmaking_type
      USING matchmaking_type::TEXT::matchmaking_type;
  `)

  await db.runSql(`DROP TYPE matchmaking_type_old;`)
}

exports.down = async function (db) {
  await db.runSql(`DELETE FROM matchmaking_map_pools WHERE matchmaking_type = '2v2';`)
  await db.runSql(`DELETE FROM matchmaking_preferences WHERE matchmaking_type = '2v2';`)
  await db.runSql(`DELETE FROM matchmaking_rating_changes WHERE matchmaking_type = '2v2';`)
  await db.runSql(`DELETE FROM matchmaking_ratings WHERE matchmaking_type = '2v2';`)
  await db.runSql(`DELETE FROM matchmaking_times WHERE matchmaking_type = '2v2';`)

  await db.runSql(`ALTER TYPE matchmaking_type RENAME TO matchmaking_type_new;`)
  await db.runSql(`CREATE TYPE matchmaking_type AS ENUM ('1v1');`)

  await db.runSql(`
    ALTER TABLE matchmaking_map_pools
    ALTER COLUMN matchmaking_type
      TYPE matchmaking_type
      USING matchmaking_type::TEXT::matchmaking_type;
  `)
  await db.runSql(`
    ALTER TABLE matchmaking_preferences
    ALTER COLUMN matchmaking_type
      TYPE matchmaking_type
      USING matchmaking_type::TEXT::matchmaking_type;
  `)
  await db.runSql(`
    ALTER TABLE matchmaking_rating_changes
    ALTER COLUMN matchmaking_type
      TYPE matchmaking_type
      USING matchmaking_type::TEXT::matchmaking_type;
  `)
  await db.runSql(`
    ALTER TABLE matchmaking_ratings
    ALTER COLUMN matchmaking_type
      TYPE matchmaking_type
      USING matchmaking_type::TEXT::matchmaking_type;
  `)
  await db.runSql(`
    ALTER TABLE matchmaking_times
    ALTER COLUMN matchmaking_type
      TYPE matchmaking_type
      USING matchmaking_type::TEXT::matchmaking_type;
  `)

  await db.runSql(`DROP TYPE matchmaking_type_new;`)
}

exports._meta = {
  version: 1,
}
