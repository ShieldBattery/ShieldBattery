exports.up = async function (db) {
  // Add a UUID column to the user_bans table so we can use it as a primary key
  await db.runSql(`
    ALTER TABLE user_bans
    ADD COLUMN id uuid NOT NULL DEFAULT uuid_generate_v4();
  `)
  // Set the new column as the primary key
  await db.runSql(`
    ALTER TABLE user_bans
    ADD PRIMARY KEY (id);
  `)

  // Remove the existing user ID index and recreate it as a compound index with start_date to
  // help with the "isUserBanned" query
  await db.runSql(`
    DROP INDEX user_bans_user_id_index;
  `)
  await db.runSql(`
    CREATE INDEX user_bans_user_id_index
    ON user_bans (user_id, start_time DESC);
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    DROP INDEX user_bans_user_id_index;
  `)
  await db.runSql(`
    CREATE INDEX user_bans_user_id_index
    ON user_bans (user_id);
  `)
  await db.runSql(`
    ALTER TABLE user_bans
    DROP COLUMN id;
  `)
}

exports._meta = {
  version: 1,
}
