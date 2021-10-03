exports.up = async function (db) {
  // NOTE(2Pac): The composite primary key is created with `channel_name` being first, which means
  // it will be more optimal to list bans for a channel, than it is for a user. This is preferred
  // for our use case, I think, since we'll mostly let channel admins to see the list of the banned
  // users in their chat channel so they can unban someone if they want.
  await db.runSql(`
    CREATE TABLE channel_bans (
      user_id integer NOT NULL,
      channel_name citext NOT NULL,
      ban_time timestamp without time zone NOT NULL DEFAULT timezone('utc', now()),
      banned_by integer NOT NULL,
      reason text,

      PRIMARY KEY (channel_name, user_id),
      FOREIGN KEY (user_id) REFERENCES users (id),
      FOREIGN KEY (channel_name) REFERENCES channels (name)
    );
  `)

  // This is a general permission which allows users to moderate all chat channels. For more
  // fine-grained control of chat channels, see `joined_channels` table.
  await db.runSql(`
    ALTER TABLE permissions
    ADD COLUMN moderate_chat_channels boolean NOT NULL DEFAULT false;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE permissions
    DROP COLUMN moderate_chat_channels;
  `)
  await db.dropTable('channel_bans')
}

exports._meta = {
  version: 1,
}
