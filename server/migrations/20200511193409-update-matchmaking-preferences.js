// Due to matchmaking preferences being saved for each matchmaking type and user combination, we add
// the `updated_at` property so we can easily determine which preferences were updated last. The one
// that was updated last will be used as a currently "active" matchmaking type, and their
// preferences will be fetched when preferences for no specific matchmaking type were requested.
// Also, we rename the `race` enum in this migration to be more in line with what we use in the rest
// of the app.
exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE matchmaking_preferences
    ADD COLUMN use_alternate_race boolean,
    ADD COLUMN updated_at timestamp without time zone;
  `)

  await db.runSql(`
    UPDATE pg_enum SET enumlabel = 'z'
    WHERE enumlabel = 'zerg' AND enumtypid = (
      SELECT oid FROM pg_type WHERE typname = 'race'
    );
    UPDATE pg_enum SET enumlabel = 't'
    WHERE enumlabel = 'terran' AND enumtypid = (
      SELECT oid FROM pg_type WHERE typname = 'race'
    );
    UPDATE pg_enum SET enumlabel = 'p'
    WHERE enumlabel = 'protoss' AND enumtypid = (
      SELECT oid FROM pg_type WHERE typname = 'race'
    );
    UPDATE pg_enum SET enumlabel = 'r'
    WHERE enumlabel = 'random' AND enumtypid = (
      SELECT oid FROM pg_type WHERE typname = 'race'
    );
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE matchmaking_preferences
    DROP COLUMN use_alternate_race,
    DROP COLUMN updated_at;
  `)

  await db.runSql(`
    UPDATE pg_enum SET enumlabel = 'zerg'
    WHERE enumlabel = 'z' AND enumtypid = (
      SELECT oid FROM pg_type WHERE typname = 'race'
    );
    UPDATE pg_enum SET enumlabel = 'terran'
    WHERE enumlabel = 't' AND enumtypid = (
      SELECT oid FROM pg_type WHERE typname = 'race'
    );
    UPDATE pg_enum SET enumlabel = 'protoss'
    WHERE enumlabel = 'p' AND enumtypid = (
      SELECT oid FROM pg_type WHERE typname = 'race'
    );
    UPDATE pg_enum SET enumlabel = 'random'
    WHERE enumlabel = 'r' AND enumtypid = (
      SELECT oid FROM pg_type WHERE typname = 'race'
    );
  `)
}

exports._meta = {
  version: 1,
}
