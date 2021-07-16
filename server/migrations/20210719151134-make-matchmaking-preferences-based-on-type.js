const sql = require('sql-template-strings')

exports.up = async function (db) {
  await db.runSql(`ALTER TABLE matchmaking_preferences ADD COLUMN data jsonb;`)
  // This column is not used anymore so it's not necessary
  await db.runSql(`ALTER TABLE matchmaking_preferences DROP COLUMN updated_at;`)

  // This should probably be batched, maybe? Shouldn't be an issue with our current amount of users,
  // I think.
  const { rows: preferences } = await db.runSql(`
    SELECT user_id, matchmaking_type, use_alternate_race, alternate_race
    FROM matchmaking_preferences;
  `)

  await Promise.all(
    preferences.map(p => {
      const data = {
        useAlternateRace: p.use_alternate_race,
        alternateRace: p.alternate_race,
      }

      return db.runSql(sql`
        UPDATE matchmaking_preferences
        SET data = ${data}
        WHERE user_id = ${p.user_id} AND matchmaking_type = ${p.matchmaking_type};
      `)
    }),
  )

  await db.runSql(`
    ALTER TABLE matchmaking_preferences
    RENAME COLUMN preferred_maps
    TO map_selections;
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

  const { rows: preferences } = await db.runSql(`
    SELECT user_id, matchmaking_type, data
    FROM matchmaking_preferences;
  `)

  await Promise.all(
    preferences.map(p =>
      db.runSql(sql`
        UPDATE matchmaking_preferences
        SET
          use_alternate_race = ${p.data.useAlternateRace},
          alternate_race = ${p.data.alternateRace}
        WHERE user_id = ${p.user_id} AND matchmaking_type = ${p.matchmaking_type};
      `),
    ),
  )

  await db.runSql(`ALTER TABLE matchmaking_preferences DROP COLUMN data;`)
  await db.runSql(`
    ALTER TABLE matchmaking_preferences
    ADD COLUMN updated_at timestamp without time zone;
  `)
}

exports._meta = {
  version: 1,
}
