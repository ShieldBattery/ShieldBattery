exports.up = function(db, callback) {
  db.addColumn('users', 'email', { type: 'string', length: 100 }, fillExisting)

  function fillExisting(err) {
    if (err) {
      callback(err)
      return
    }
    const sql = 'UPDATE users SET email=?'
    db.runSql(sql, ['unset@example.com'], changeEmail)
  }

  function changeEmail(err) {
    if (err) {
      callback(err)
      return
    }
    db.changeColumn('users', 'email', { notNull: true }, callback)
  }
}

exports.down = function(db, callback) {
  db.removeColumn('users', 'email', callback)
}
