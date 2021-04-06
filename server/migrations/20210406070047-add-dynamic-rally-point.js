exports.up = async function (db) {
  await db.runSql(`
    CREATE TABLE rally_point_servers (
      id serial PRIMARY KEY,
      enabled boolean NOT NULL,
      description varchar(64),
      hostname varchar(64),
      port smallint
    );
  `)

  await db.runSql(`
    ALTER TABLE permissions
    ADD COLUMN manage_rally_point_servers boolean NOT NULL DEFAULT false;
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE permissions
    DROP COLUMN manage_rally_point_servers;
  `)
  await db.dropTable('rally_point_servers')
}

exports._meta = {
  version: 1,
}
