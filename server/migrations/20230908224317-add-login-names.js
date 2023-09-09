exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE users
    ADD COLUMN login_name citext UNIQUE;
  `)

  // Add a constraint matching the display name one for length
  await db.runSql(`
    ALTER TABLE users
    ADD CONSTRAINT login_name_length_check CHECK (length(login_name::text) <= 32);
  `)

  await db.runSql(`
    UPDATE users
    SET login_name = name;
  `)
  await db.runSql(`
    ALTER TABLE users
    ALTER COLUMN login_name SET NOT NULL;
  `)
  // NOTE(tec27): no explicit index needed, the unique constraint creates one automatically
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE users
    DROP CONSTRAINT login_name_length_check;
  `)
  await db.runSql(`
    ALTER TABLE users
    DROP COLUMN login_name;
  `)
}

exports._meta = {
  version: 1,
}
