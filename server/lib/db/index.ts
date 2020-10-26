import pg from 'pg'

// Our DATETIME columns are all in UTC, so we mark the strings postgres returns this way so the
// parsed dates are correct
pg.types.setTypeParser(1114, (stringValue: string) => new Date(Date.parse(stringValue + '+0000')))

// Similar to above, we must also parse input dates as UTC so the servers running on different time
// zones work correctly
pg.defaults.parseInputDatesAsUTC = true

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL must be set')

const pool = new pg.Pool({ connectionString })

export type DbClient = pg.PoolClient
export type DbDone = (release?: unknown) => void

export interface ClientResult {
  /**
   * A usable database client. This should be released by calling `done` when the DB operations are
   * completed.
   */
  client: DbClient
  /**
   * A method to release the client back to the pool. Optionally, a parameter can be passed
   * indicating whether the client should be thrown away rather than re-used.
   */
  done: DbDone
}

// TODO(tec27): I think it might be better to wrap the query functions instead of just wrapping the
// client pool getter, but since I don't know how we'll be using this too much yet I'm just
// keeping it simple for now
export default function getDbClient() {
  return new Promise<ClientResult>((resolve, reject) => {
    pool.connect((err, client, done) => {
      if (err) reject(err)
      else resolve({ client, done })
    })
  })
}

/**
 * Executes `fn` with a database client, automatically releasing the client when completed. Any
 * additional arguments will be passed along with the `DbClient`.
 */
export async function withDbClient<T, U extends any[]>(
  fn: (client: DbClient, ...args: U) => Promise<T>,
  ...args: U
): Promise<T> {
  const { client, done } = await getDbClient()
  try {
    return await fn(client, ...args)
  } finally {
    done()
  }
}
