exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE channels
    ADD COLUMN user_count integer NOT NULL DEFAULT 0;
  `)

  await db.runSql(`
    WITH cu AS (
      SELECT channel_id, COUNT(user_id) AS user_count
      FROM channel_users
      GROUP BY channel_id
    )
    UPDATE channels
    SET user_count = cu.user_count
    FROM cu
    WHERE id = cu.channel_id;
  `)

  await db.runSql(`
    CREATE FUNCTION update_channels_user_count() RETURNS TRIGGER
    AS $$
      BEGIN
        IF (TG_OP = 'DELETE') THEN
          UPDATE channels
          SET user_count = user_count - 1
          WHERE id = OLD.channel_id;

          RETURN OLD;
        ELSIF (TG_OP = 'INSERT') THEN
          UPDATE channels
          SET user_count = user_count + 1
          WHERE id = NEW.channel_id;

          RETURN NEW;
        END IF;

        RETURN NULL;
      END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER channel_users_insert_delete
    AFTER INSERT OR DELETE ON channel_users
      FOR EACH ROW EXECUTE FUNCTION update_channels_user_count();
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    DROP TRIGGER channel_users_insert_delete ON channel_users;
  `)

  await db.runSql(`
    DROP FUNCTION update_channels_user_count;
  `)

  await db.runSql(`
    ALTER TABLE channels
    DROP COLUMN user_count;
  `)
}

exports._meta = {
  version: 1,
}
