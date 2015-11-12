'use strict'

let dbm
  , type
  , seed

exports.setup = function(options, seedLink) {
  dbm = options.dbmigrate
  type = dbm.dataType
  seed = seedLink
}

exports.up = function(db, callback) {
  db.addColumn('users', 'email', { type: 'string', length: 100 }, fillExisting)

  function fillExisting(err) {
    if (err) return callback(err)
    var sql = 'UPDATE users SET email=?'
    db.runSql(sql, ['unset@example.com'], changeEmail)
  }

  function changeEmail(err) {
    if (err) return callback(err)
    db.changeColumn('users', 'email', { notNull: true }, callback)
  }
};

exports.down = function(db, callback) {
  db.removeColumn('users', 'email', callback)
};
