exports.up = function(db, callback) {
  db.createTable('permissions',
      { user_id: { type: 'int', primaryKey: true },
        edit_permissions: { type: 'boolean', notNull: true, defaultValue: false },
        debug: { type: 'boolean', notNull: true, defaultValue: false },
        accept_invites: { type: 'boolean', notNull: true, defaultValue: false }
      }, fillExisting)

  function fillExisting(err) {
    if (err) return callback(err)
    const sql = 'INSERT INTO permissions (user_id) SELECT id FROM users'
    db.runSql(sql, [], callback)
  }
}

exports.down = function(db, callback) {
  db.dropTable('permissions', callback)
}
