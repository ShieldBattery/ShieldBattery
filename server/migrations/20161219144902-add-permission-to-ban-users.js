exports.up = function(db, cb) {
  db.runSql(`ALTER TABLE permissions
      ADD COLUMN ban_users boolean NOT NULL DEFAULT false;`, cb)
}

exports.down = function(db, cb) {
  db.runSql('ALTER TABLE permissions DROP COLUMN ban_users;', cb)
}
