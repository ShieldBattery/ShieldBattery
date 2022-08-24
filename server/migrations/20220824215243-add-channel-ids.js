exports.up = async function (db) {
  // We can't make this column a primary key until we remove the old primary key. And we can't do
  // that until all other tables that reference the old primary key are updated first.
  await db.runSql(`
    ALTER TABLE channels
    ADD COLUMN id serial;
  `)

  // Update the `channel_users` table. Things to update:
  //   - replace the `channel_name` column with `channel_id`
  //   - recreate the primary key with `channel_id` being the second component of an (x, y)
  //     composite
  //   - recreate the foreign key referencing the `id` column in `channels` (this is done below)
  //   - recreate the index on `channel_id` column
  await db.runSql(`
    ALTER TABLE channel_users
    ADD COLUMN channel_id integer;

    UPDATE channel_users cu
    SET channel_id = (SELECT id FROM channels WHERE name = cu.channel_name);

    ALTER TABLE channel_users
    ALTER COLUMN channel_id SET NOT NULL;

    ALTER TABLE channel_users
    DROP COLUMN channel_name;

    ALTER TABLE channel_users
    ADD PRIMARY KEY (user_id, channel_id);

    CREATE INDEX channel_users_channel_id_index ON channel_users (channel_id);
  `)

  // Update the `channel_bans` table. Things to update:
  //   - replace the `channel_name` column with `channel_id`
  //   - recreate the primary key with `channel_id` being the first component of an (x, y) composite
  //   - recreate the foreign key referencing the `id` column in `channels` (this is done below)
  await db.runSql(`
    ALTER TABLE channel_bans
    ADD COLUMN channel_id integer;

    UPDATE channel_bans cb
    SET channel_id = (SELECT id FROM channels WHERE name = cb.channel_name);

    ALTER TABLE channel_bans
    ALTER COLUMN channel_id SET NOT NULL;

    ALTER TABLE channel_bans
    DROP COLUMN channel_name;

    ALTER TABLE channel_bans
    ADD PRIMARY KEY (channel_id, user_id);
  `)

  // Update the `channel_messages` table. Things to update:
  //   - purge the messages that are left in channels that no longer exist
  //   - replace the `channel_messages` column with `channel_id`
  //   - create the foreign key referencing the `id` column in `channels` (this is done below)
  //   - recreate the index on `channel_id` column
  await db.runSql(`
    DELETE FROM channel_messages
    WHERE channel_name NOT IN (SELECT name FROM channels);

    ALTER TABLE channel_messages
    ADD COLUMN channel_id integer;

    UPDATE channel_messages cm
    SET channel_id = (SELECT id FROM channels WHERE name = cm.channel_name);

    ALTER TABLE channel_messages
    ALTER COLUMN channel_id SET NOT NULL;

    ALTER TABLE channel_messages
    DROP COLUMN channel_name;

    CREATE INDEX channel_messages_channel_id_index ON channel_messages (channel_id);
  `)

  // We can now make the new column a primary key.
  await db.runSql(`
    ALTER TABLE channels
    DROP CONSTRAINT channels_pkey,
    ADD PRIMARY KEY (id);
  `)

  // And finally, after we have a new primary key, we can reference it in the foreign key of tables
  // that use it.
  await db.runSql(`
    ALTER TABLE channel_users
    ADD CONSTRAINT fk_channel_id FOREIGN KEY (channel_id) REFERENCES channels (id);

    ALTER TABLE channel_bans
    ADD CONSTRAINT fk_channel_id
      FOREIGN KEY (channel_id) REFERENCES channels (id) ON DELETE CASCADE;

    ALTER TABLE channel_messages
    ADD CONSTRAINT fk_channel_id
      FOREIGN KEY (channel_id) REFERENCES channels (id) ON DELETE CASCADE;
  `)

  // As a cherry on top, we make the `name` column unique, so we don't accidentally create two
  // channels with a same name.
  await db.runSql(`
    ALTER TABLE channels
    ADD CONSTRAINT channel_name_unique UNIQUE (name);
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE channels
    DROP CONSTRAINT channel_name_unique;
  `)

  await db.runSql(`
    ALTER TABLE channel_users
    ADD COLUMN channel_name citext;

    UPDATE channel_users cu
    SET channel_name = (SELECT name FROM channels WHERE id = cu.channel_id);

    ALTER TABLE channel_users
    ALTER COLUMN channel_name SET NOT NULL;

    ALTER TABLE channel_users
    DROP COLUMN channel_id;

    ALTER TABLE channel_users
    ADD PRIMARY KEY (user_id, channel_name);

    CREATE INDEX channel_users_channel_name_index ON channel_users (channel_name);
  `)

  await db.runSql(`
    ALTER TABLE channel_bans
    ADD COLUMN channel_name citext;

    UPDATE channel_bans cb
    SET channel_name = (SELECT name FROM channels WHERE id = cb.channel_id);

    ALTER TABLE channel_bans
    ALTER COLUMN channel_name SET NOT NULL;

    ALTER TABLE channel_bans
    DROP COLUMN channel_id;

    ALTER TABLE channel_bans
    ADD PRIMARY KEY (channel_name, user_id);
  `)

  await db.runSql(`
    ALTER TABLE channel_messages
    ADD COLUMN channel_name citext;

    UPDATE channel_messages cm
    SET channel_name = (SELECT name FROM channels WHERE id = cm.channel_id);

    ALTER TABLE channel_messages
    ALTER COLUMN channel_name SET NOT NULL;

    ALTER TABLE channel_messages
    DROP COLUMN channel_id;

    CREATE INDEX channel_messages_channel_name_index ON channel_messages (channel_name);
  `)

  await db.runSql(`
    ALTER TABLE channels
    DROP COLUMN id;

    ALTER TABLE channels
    ADD PRIMARY KEY (name);
  `)

  await db.runSql(`
    ALTER TABLE channel_users
    ADD CONSTRAINT fk_channel_name FOREIGN KEY (channel_name) REFERENCES channels (name);

    ALTER TABLE channel_bans
    ADD CONSTRAINT fk_channel_name FOREIGN KEY (channel_name) REFERENCES channels (name);
  `)
}

exports._meta = {
  version: 1,
}
