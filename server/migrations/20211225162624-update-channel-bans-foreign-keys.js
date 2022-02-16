exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE channel_bans
    DROP CONSTRAINT channel_bans_user_id_fkey,
    DROP CONSTRAINT channel_bans_banned_by_fkey,
    DROP CONSTRAINT channel_bans_channel_name_fkey;
  `)

  await db.runSql(`
    ALTER TABLE channel_bans
    ADD CONSTRAINT channel_bans_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    ADD CONSTRAINT channel_bans_banned_by_fkey
      FOREIGN KEY (banned_by) REFERENCES users (id) ON DELETE CASCADE,
    ADD CONSTRAINT channel_bans_channel_name_fkey
      FOREIGN KEY (channel_name) REFERENCES channels (name) ON DELETE CASCADE;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE channel_bans
    DROP CONSTRAINT channel_bans_user_id_fkey,
    DROP CONSTRAINT channel_bans_banned_by_fkey,
    DROP CONSTRAINT channel_bans_channel_name_fkey;
  `)

  await db.runSql(`
    ALTER TABLE channel_bans
    ADD CONSTRAINT channel_bans_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users (id),
    ADD CONSTRAINT channel_bans_banned_by_fkey
      FOREIGN KEY (banned_by) REFERENCES users (id),
    ADD CONSTRAINT channel_bans_channel_name_fkey
      FOREIGN KEY (channel_name) REFERENCES channels (name);
  `)
}

exports._meta = {
  version: 1,
}
