exports.up = function(db, cb) {
  db.runSql('ALTER TABLE users ADD COLUMN signup_ip_address inet;', createSignupIpAddressIndex)

  function createSignupIpAddressIndex(err) {
    if (err) {
      cb(err)
      return
    }

    db.addIndex('users', 'users_signup_ip_address_index', ['signup_ip_address'],
      false /* unique */, cb)
  }
}

exports.down = function(db, cb) {
  db.runSql('ALTER TABLE users DROP COLUMN signup_ip_address;', cb)
}
