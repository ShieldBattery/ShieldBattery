var pg = require('pg')
  , thenify = require('thenify')
  , config = require('../../config.js')
  , connString = config.db.connString

if (!connString) throw new Error('db.connString must be set in config.js')

// TODO(tec27): I think it might be better to wrap the query functions instead of just wrapping the
// client pool getter, but since I don't know how we'll be using this too much yet I'm just
// keeping it simple for now
module.exports = function(config) {
  return new Promise((resolve, reject) => {
    pg.connect(connString, (err, client, done) => {
      if (err) reject(err)
      else resolve({ client: client, done: done })
    })
  })
}

pg.Client.prototype.queryPromise = thenify(pg.Client.prototype.query)
