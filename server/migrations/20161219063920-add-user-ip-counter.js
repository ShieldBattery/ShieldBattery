exports.up = function(db) {
  return db
    .runSql('TRUNCATE user_ips;')
    .then(() => {
      return db.runSql('ALTER TABLE user_ips ADD COLUMN user_ip_counter integer NOT NULL;')
    })
    .then(() => {
      return db.addIndex('user_ips', 'user_ips_unique_user_ip_counter_index', [
        'user_id',
        'ip_address',
        'user_ip_counter',
      ])
    })
}

exports.down = function(db) {
  return db.runSql('ALTER TABLE user_ips DROP COLUMN user_ip_counter;')
}
