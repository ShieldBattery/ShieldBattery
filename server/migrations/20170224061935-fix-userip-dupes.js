exports.up = function(db) {
  return db
    .runSql(
      `
    WITH dupe_entries AS (
      SELECT DISTINCT user_id, ip_address, user_ip_counter, MIN(first_used) as first_first_used
      FROM user_ips
      GROUP BY user_id, ip_address, user_ip_counter HAVING COUNT(*) > 1
    ) DELETE FROM user_ips USING dupe_entries
    WHERE user_ips.user_id = dupe_entries.user_id AND
        user_ips.ip_address = dupe_entries.ip_address AND
        user_ips.user_ip_counter = dupe_entries.user_ip_counter AND
        user_ips.first_used != dupe_entries.first_first_used;
  `,
    )
    .then(() => {
      return db.removeIndex('user_ips', 'user_ips_unique_user_ip_counter_index')
    })
    .then(() => {
      return db.addIndex(
        'user_ips',
        'user_ips_unique_user_ip_counter_index',
        ['user_id', 'ip_address', 'user_ip_counter'],
        true /* unique */,
      )
    })
}

exports.down = function(db) {
  return db.removeIndex('user_ips', 'user_ips_unique_user_ip_counter_index').then(() => {
    return db.addIndex('user_ips', 'user_ips_unique_user_ip_counter_index', [
      'user_id',
      'ip_address',
      'user_ip_counter',
    ])
  })
}

exports._meta = {
  version: 1,
}
