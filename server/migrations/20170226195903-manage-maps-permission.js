exports.up = function(db, cb) {
  db.runSql(`ALTER TABLE permissions
      ADD COLUMN manage_maps boolean NOT NULL DEFAULT false;`, cb)
}

exports.down = function(db, cb) {
  db.runSql('ALTER TABLE permissions DROP COLUMN manage_maps;', cb)
}
