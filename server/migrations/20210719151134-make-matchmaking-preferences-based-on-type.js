const sql = require('sql-template-strings')

exports.up = async function (db) {
  await db.runSql(`ALTER TABLE matchmaking_preferences ADD COLUMN data jsonb;`)
  // This column is not used anymore so it's not necessary
  await db.runSql(`ALTER TABLE matchmaking_preferences DROP COLUMN updated_at;`)

  await db.runSql(`
    UPDATE matchmaking_preferences
    SET data = jsonb_build_object(
      'useAlternateRace', COALESCE(use_alternate_race, false),
      'alternateRace', COALESCE(alternate_race, 'z')
    );
  `)

  await db.runSql(`
    ALTER TABLE matchmaking_preferences
    RENAME COLUMN preferred_maps
    TO map_selections;
  `)
  await db.runSql(sql`
    UPDATE matchmaking_preferences
    SET map_selections = ${[]}
    WHERE map_selections IS NULL;
  `)
  await db.runSql(`ALTER TABLE matchmaking_preferences ALTER COLUMN map_selections SET NOT NULL;`)
  await db.runSql(`ALTER TABLE matchmaking_preferences ALTER COLUMN data SET NOT NULL;`)
  await db.runSql(`ALTER TABLE matchmaking_preferences DROP COLUMN use_alternate_race;`)
  await db.runSql(`ALTER TABLE matchmaking_preferences DROP COLUMN alternate_race;`)
}

exports.down = async function (db) {
  await db.runSql(`ALTER TABLE matchmaking_preferences ADD COLUMN use_alternate_race boolean;`)
  await db.runSql(`ALTER TABLE matchmaking_preferences ADD COLUMN alternate_race race;`)
  await db.runSql(`
    ALTER TABLE matchmaking_preferences
    RENAME COLUMN map_selections
    TO preferred_maps;
  `)
  await db.runSql(`ALTER TABLE matchmaking_preferences ALTER COLUMN preferred_maps DROP NOT NULL;`)

  db.runSql(`
    UPDATE matchmaking_preferences
    SET
      use_alternate_race = (data->>'useAlternateRace')::boolean,
      alternate_race = (data->>'alternateRace')::race;
  `)

  await db.runSql(`ALTER TABLE matchmaking_preferences DROP COLUMN data;`)
  await db.runSql(`
    ALTER TABLE matchmaking_preferences
    ADD COLUMN updated_at timestamp without time zone;
  `)
}

exports._meta = {
  version: 1,
}
