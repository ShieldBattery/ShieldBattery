exports.up = async function (db) {
  // We don't use `ON DELETE CASCADE` here which means that a user can't be deleted if they're still
  // an owner of a channel. This shouldn't really matter since we'll probably never delete user rows
  // outright, but it also serves as a safety check so we don't lose a whole channel by deleting a
  // single user in that channel, even if that user is the owner. Although we probably *should*
  // delete a channel if they're were the only user in it, but not sure if that's even possible to
  // write in SQL, so yeah... just make sure to transfer the channel ownership before deleting a
  // user and everything should be fine :d
  await db.runSql(`
    ALTER TABLE channels
    ADD COLUMN owner_id integer;
  `)

  await db.runSql(`
    ALTER TABLE channels
    ADD CONSTRAINT channels_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users (id);
  `)

  // This should be safe to do because in previous migration we updated all channels to have an
  // owner.
  await db.runSql(`
    UPDATE channels AS c
    SET owner_id = cu.user_id
    FROM channel_users AS cu
    WHERE c.name = cu.channel_name AND cu.owner = true;
  `)

  await db.runSql(`
    ALTER TABLE channels
    ALTER COLUMN owner_id SET NOT NULL;
  `)

  await db.runSql(`
    DROP INDEX joined_channels_owner;
  `)

  await db.runSql(`
    ALTER TABLE channel_users
    DROP COLUMN owner;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE channel_users
    ADD COLUMN owner
    BOOLEAN NOT NULL DEFAULT false;
  `)

  await db.runSql(`
    CREATE UNIQUE INDEX joined_channels_owner
    ON channel_users (channel_name, owner)
    WHERE owner = true;
  `)

  await db.runSql(`
    UPDATE channel_users AS cu
    SET owner = true
    FROM channels AS c
    WHERE c.name = cu.channel_name AND c.owner_id = cu.user_id;
  `)

  await db.runSql(`
    ALTER TABLE channels
    DROP COLUMN owner_id;
  `)
}

exports._meta = {
  version: 1,
}
