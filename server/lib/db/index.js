import pg from 'pg'

// Our DATETIME columns are all in UTC, so we mark the strings postgres returns this way so the
// parsed dates are correct
pg.types.setTypeParser(1114, stringValue => new Date(Date.parse(stringValue + '+0000')))

// Similar to above, we must also parse input dates as UTC so the servers running on different time
// zones work correctly
pg.defaults.parseInputDatesAsUTC = true

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL must be set')

const pool = new pg.Pool({ connectionString })

// TODO(tec27): I think it might be better to wrap the query functions instead of just wrapping the
// client pool getter, but since I don't know how we'll be using this too much yet I'm just
// keeping it simple for now
export default function () {
  return new Promise((resolve, reject) => {
    pool.connect((err, client, done) => {
      if (err) reject(err)
      else resolve({ client, done })
    })
  })
}
