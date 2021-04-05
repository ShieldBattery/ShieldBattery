exports.up = async function (db) {
  await db.runSql(`
    CREATE TABLE server_logs (
      id uuid NOT NULL DEFAULT uuid_generate_v4(),
      time timestamp without time zone NOT NULL DEFAULT timezone('utc', now()),
      data jsonb NOT NULL,

      PRIMARY KEY (id)
    );
  `)

  await db.runSql(`
    CREATE INDEX time_index ON server_logs (time DESC);
  `)
  await db.runSql(`
    CREATE INDEX req_id_index ON server_logs USING HASH ((data->'req'->>'id'))
    WHERE (data->'req'->>'id') IS NOT NULL;
  `)
}

exports.down = async function (db) {
  await db.dropTable('server_logs')
}

exports._meta = {
  version: 1,
}
