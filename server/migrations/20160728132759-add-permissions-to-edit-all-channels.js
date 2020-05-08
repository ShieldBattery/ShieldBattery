exports.up = function (db, cb) {
  db.runSql(
    `ALTER TABLE permissions
      ADD COLUMN edit_all_channels boolean NOT NULL DEFAULT false;`,
    cb,
  )
}

exports.down = function (db, cb) {
  db.runSql('ALTER TABLE permissions DROP COLUMN edit_all_channels;', cb)
}
