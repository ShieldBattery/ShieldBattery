// We rename the `race` enum in this migration to be more in line with what we use in the rest of
// the app. Note that Postgres 10+ has better syntax for doing this but we unfortunately still
// support older versions.
exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE matchmaking_preferences ALTER COLUMN race TYPE varchar(64);
    ALTER TABLE matchmaking_preferences ALTER COLUMN alternate_race TYPE varchar(64);
    DROP TYPE race;

    UPDATE matchmaking_preferences SET race = 'z' WHERE race = 'zerg';
    UPDATE matchmaking_preferences SET race = 't' WHERE race = 'terran';
    UPDATE matchmaking_preferences SET race = 'p' WHERE race = 'protoss';
    UPDATE matchmaking_preferences SET race = 'r' WHERE race = 'random';

    UPDATE matchmaking_preferences SET alternate_race = 'z' WHERE alternate_race = 'zerg';
    UPDATE matchmaking_preferences SET alternate_race = 't' WHERE alternate_race = 'terran';
    UPDATE matchmaking_preferences SET alternate_race = 'p' WHERE alternate_race = 'protoss';
    UPDATE matchmaking_preferences SET alternate_race = 'r' WHERE alternate_race = 'random';

    CREATE TYPE race AS ENUM('z', 't', 'p', 'r');

    ALTER TABLE matchmaking_preferences ALTER COLUMN race TYPE race USING race::race;
    ALTER TABLE matchmaking_preferences ALTER COLUMN alternate_race TYPE race
        USING alternate_race::race;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE matchmaking_preferences ALTER COLUMN race TYPE varchar(64);
    ALTER TABLE matchmaking_preferences ALTER COLUMN alternate_race TYPE varchar(64);
    DROP TYPE race;

    UPDATE matchmaking_preferences SET race = 'zerg' WHERE race = 'z';
    UPDATE matchmaking_preferences SET race = 'terran' WHERE race = 't';
    UPDATE matchmaking_preferences SET race = 'protoss' WHERE race = 'p';
    UPDATE matchmaking_preferences SET race = 'random' WHERE race = 'r';

    UPDATE matchmaking_preferences SET alternate_race = 'zerg' WHERE alternate_race = 'z';
    UPDATE matchmaking_preferences SET alternate_race = 'terran' WHERE alternate_race = 't';
    UPDATE matchmaking_preferences SET alternate_race = 'protoss' WHERE alternate_race = 'p';
    UPDATE matchmaking_preferences SET alternate_race = 'random' WHERE alternate_race = 'r';

    CREATE TYPE race AS ENUM('zerg', 'terran', 'protoss', 'random');

    ALTER TABLE matchmaking_preferences ALTER COLUMN race TYPE race USING race::race;
    ALTER TABLE matchmaking_preferences ALTER COLUMN alternate_race TYPE race
        USING alternate_race::race;
  `)
}

exports._meta = {
  version: 1,
}
