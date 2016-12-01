exports.up = function(db, callback) {
  db.createTable('invites',
    { email: { type: 'string', length: 100, primaryKey: true },
      token: { type: 'string', length: 50 },
      teamliquid_name: { type: 'string', length: 20 },
      os: { type: 'string', length: 50 },
      browser: { type: 'string', length: 50 },
      graphics: { type: 'string', length: 50 },
      can_host: { type: 'boolean' }
    }, callback)
}

exports.down = function(db, callback) {
  db.dropTable('invites', callback)
}
