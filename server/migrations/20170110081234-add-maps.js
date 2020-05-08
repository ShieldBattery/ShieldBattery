exports.up = function (db, cb) {
  db.runSql(
    `
      CREATE TABLE maps (
        hash bytea PRIMARY KEY,
        extension char(3) NOT NULL,
        filename varchar(32) NOT NULL,
        title text NOT NULL,
        description text NOT NULL,
        width integer NOT NULL,
        height integer NOT NULL,
        tileset integer NOT NULL,
        players_melee integer NOT NULL,
        players_ums integer NOT NULL,
        upload_time timestamp without time zone NOT NULL,
        modified_time timestamp without time zone NOT NULL,
        lobby_init_data jsonb NOT NULL
      );`,
    cb,
  )
}

exports.down = function (db, cb) {
  db.dropTable('maps', cb)
}
