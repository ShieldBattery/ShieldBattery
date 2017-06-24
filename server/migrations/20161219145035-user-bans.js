exports.up = function(db, cb) {
  db.runSql(`
      CREATE TABLE user_bans (
        user_id integer NOT NULL,
        start_time timestamp without time zone NOT NULL,
        end_time timestamp without time zone NOT NULL,
        banned_by int NOT NULL,
        reason text
      );`, createUserIdIndex)

  function createUserIdIndex(err) {
    if (err) {
      cb(err)
      return
    }

    db.addIndex('user_bans', 'user_bans_user_id_index', ['user_id'],
      false /* unique */, cb)
  }
}

exports.down = function(db, cb) {
  db.dropTable('user_bans', cb)
}
