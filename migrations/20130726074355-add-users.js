exports.up = function(db, callback) {
  db.createTable('users',
    { id: { type: 'int', primaryKey: true, autoIncrement: true },
      name: { type: 'string', length: 32, unique: true, notNull: true },
      password: { type: 'string', length: 60, notNull: true },
      created: { type: 'datetime', notNull: true }
    }, callback)
}

exports.down = function(db, callback) {
  db.dropTable('users', callback)
}
