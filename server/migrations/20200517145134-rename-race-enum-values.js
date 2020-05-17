// We rename the `race` enum in this migration to be more in line with what we use in the rest of
// the app.
exports.up = async function (db) {
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
