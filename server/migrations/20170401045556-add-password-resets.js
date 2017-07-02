exports.up = function(db) {
  return db.runSql(`
    CREATE TABLE password_resets (
      user_id integer NOT NULL,
      reset_code varchar(50) NOT NULL,
      request_time timestamp without time zone NOT NULL,
      request_ip inet NOT NULL,
      used boolean NOT NULL,

      PRIMARY KEY (user_id, reset_code)
    );
  `)
}

exports.down = function(db) {
  return db.dropTable('password_resets')
}

exports._meta = {
  version: 1,
}
