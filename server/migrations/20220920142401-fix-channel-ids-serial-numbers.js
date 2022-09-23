exports.up = async function (db) {
  // 1) Revert the previous migration which added channel IDs, including the tables that were added
  // after that migration.
  await db.runSql(`
    ALTER TABLE channel_users
    ADD COLUMN channel_name citext;

    UPDATE channel_users cu
    SET channel_name = (SELECT name FROM channels WHERE id = cu.channel_id);

    ALTER TABLE channel_users
    DROP COLUMN channel_id;
  `)

  await db.runSql(`
    ALTER TABLE channel_bans
    ADD COLUMN channel_name citext;

    UPDATE channel_bans cb
    SET channel_name = (SELECT name FROM channels WHERE id = cb.channel_id);

    ALTER TABLE channel_bans
    DROP COLUMN channel_id;
  `)

  await db.runSql(`
    ALTER TABLE channel_messages
    ADD COLUMN channel_name citext;

    UPDATE channel_messages cm
    SET channel_name = (SELECT name FROM channels WHERE id = cm.channel_id);

    ALTER TABLE channel_messages
    DROP COLUMN channel_id;
  `)

  await db.runSql(`
    ALTER TABLE channel_identifier_bans
    ADD COLUMN channel_name citext;

    UPDATE channel_identifier_bans cib
    SET channel_name = (SELECT name FROM channels WHERE id = cib.channel_id);

    ALTER TABLE channel_identifier_bans
    DROP COLUMN channel_id;
  `)

  await db.runSql(`
    ALTER TABLE channels
    DROP COLUMN id;
  `)

  // 2) Create a new channel ID column, assign 1 to "ShieldBattery" channel ID and
  // `row_number() + 1` to all other channels.
  await db.runSql(`
    ALTER TABLE channels
    ADD COLUMN id integer;

    UPDATE channels
    SET id = 1
    WHERE name = 'ShieldBattery';

    WITH rn AS (
      SELECT row_number() over() + 1 as id, name
      FROM channels
    )
    UPDATE channels c
    SET id = rn.id
    FROM rn
    WHERE c.name = rn.name AND c.name <> 'ShieldBattery';
  `)

  // 3) Create a sequence and use it for channel ID column.
  await db.runSql(`
    CREATE SEQUENCE channels_id_seq;

    ALTER TABLE channels
    ALTER COLUMN id SET DEFAULT nextval('channels_id_seq');

    ALTER TABLE channels
    ALTER COLUMN id SET NOT NULL;

    ALTER SEQUENCE channels_id_seq OWNED BY channels.id;

    WITH c AS (
      SELECT MAX(id) AS max_id
      FROM channels
    )
    SELECT setval('channels_id_seq', c.max_id)
    FROM c;
  `)

  // 4) Finally, migrate all the channel tables back to channel ID.
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

  await db.runSql(`
    ALTER TABLE channel_identifier_bans
    ADD COLUMN channel_id integer;

    UPDATE channel_identifier_bans cib
    SET channel_id = (SELECT id FROM channels WHERE name = cib.channel_name);

    ALTER TABLE channel_identifier_bans
    ALTER COLUMN channel_id SET NOT NULL;

    ALTER TABLE channel_identifier_bans
    DROP COLUMN channel_name;

    ALTER TABLE channel_identifier_bans
    ADD PRIMARY KEY (channel_id, identifier_type, identifier_hash);
  `)

  await db.runSql(`
    ALTER TABLE channels
    ADD PRIMARY KEY (id);
  `)

  await db.runSql(`
    ALTER TABLE channel_users
    ADD CONSTRAINT fk_channel_id FOREIGN KEY (channel_id) REFERENCES channels (id);

    ALTER TABLE channel_bans
    ADD CONSTRAINT fk_channel_id
      FOREIGN KEY (channel_id) REFERENCES channels (id) ON DELETE CASCADE;

    ALTER TABLE channel_messages
    ADD CONSTRAINT fk_channel_id
      FOREIGN KEY (channel_id) REFERENCES channels (id) ON DELETE CASCADE;

    ALTER TABLE channel_identifier_bans
    ADD CONSTRAINT fk_channel_id
      FOREIGN KEY (channel_id) REFERENCES channels (id) ON DELETE CASCADE;
  `)
}

exports.down = async function (db) {
  // Nothing to do here
}

exports._meta = {
  version: 1,
}
