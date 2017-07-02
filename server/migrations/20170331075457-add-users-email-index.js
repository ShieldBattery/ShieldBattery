exports.up = function(db) {
  return db.addIndex('users', 'users_email_index', 'email')
}

exports.down = function(db) {
  return db.removeIndex('users', 'users_email_index')
}

exports._meta = {
  version: 1,
}
