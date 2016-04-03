import pg from 'pg'
import thenify from 'thenify'
import config from '../../config.js'

// Our DATETIME columns are all in UTC, so we mark the strings postgres returns this way so the
// parsed dates are correct
pg.types.setTypeParser(1114, stringValue => new Date(Date.parse(stringValue + '+0000')))

const connString = config.db.connString
if (!connString) throw new Error('db.connString must be set in config.js')

// TODO(tec27): I think it might be better to wrap the query functions instead of just wrapping the
// client pool getter, but since I don't know how we'll be using this too much yet I'm just
// keeping it simple for now
export default function() {
  return new Promise((resolve, reject) => {
    pg.connect(connString, (err, client, done) => {
      if (err) reject(err)
      else resolve({ client, done })
    })
  })
}

pg.Client.prototype.queryPromise = thenify(pg.Client.prototype.query)
