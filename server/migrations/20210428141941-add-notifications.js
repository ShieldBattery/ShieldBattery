exports.up = async function (db) {
  await db.runSql(`
    CREATE TABLE notifications (
      id uuid NOT NULL DEFAULT uuid_generate_v4(),
      user_id integer NOT NULL,
      data jsonb NOT NULL,
      read boolean NOT NULL DEFAULT false,
      visible boolean NOT NULL DEFAULT true,
      created_at timestamp without time zone NOT NULL,

      PRIMARY KEY (id)
    );
  `)

  await db.runSql(`
    CREATE INDEX user_id_index ON notifications (user_id);
    CREATE INDEX created_at_index ON notifications (created_at DESC);
    CREATE INDEX notification_type_index ON notifications ((data->>'type'));
  `)
}

exports.down = async function (db) {
  await db.dropTable('notifications')
}

exports._meta = {
  version: 1,
}
