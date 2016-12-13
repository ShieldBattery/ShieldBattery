exports.up = function(db, cb) {
  db.runSql('ALTER TABLE users ADD COLUMN ip_address_at_signup inet;', createIpAddressIndex)

  function createIpAddressIndex(err) {
    if (err) {
      cb(err)
      return
    }

    db.addIndex('users', 'users_ip_address_index', ['ip_address_at_signup'],
        false /* unique */, cb)
  }
}

exports.down = function(db, cb) {
  db.runSql('ALTER TABLE users DROP COLUMN ip_address_at_signup;', cb)
}
