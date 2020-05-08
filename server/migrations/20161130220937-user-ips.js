exports.up = function (db, cb) {
  db.runSql(
    `
      CREATE TABLE user_ips (
        user_id integer NOT NULL,
        ip_address inet NOT NULL,
        first_used timestamp without time zone NOT NULL,
        last_used timestamp without time zone NOT NULL
      );`,
    createUserIdIndex,
  )

  function createUserIdIndex(err) {
    if (err) {
      cb(err)
      return
    }

    db.addIndex(
      'user_ips',
      'user_ips_user_id_index',
      ['user_id'],
      false /* unique */,
      createIpAddressIndex,
    )
  }

  function createIpAddressIndex(err) {
    if (err) {
      cb(err)
      return
    }

    db.addIndex('user_ips', 'user_ips_ip_address_index', ['ip_address'], false /* unique */, cb)
  }
}

exports.down = function (db, cb) {
  db.dropTable('user_ips', cb)
}
