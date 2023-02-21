import pg from 'pg'
import { isTestRun } from '../../../common/is-test-run'
import log from '../logging/logger'
import handlePgError from './pg-error-handler'

/**
 * The amount of time queries are allowed to run for before they are considered "slow" and logged
 * as a warning.
 */
const SLOW_QUERY_TIME_MS = 1000

// Our DATETIME columns are all in UTC, so we mark the strings postgres returns this way so the
// parsed dates are correct
pg.types.setTypeParser(
  pg.types.builtins.TIMESTAMP,
  (stringValue: string) => new Date(Date.parse(stringValue + '+0000')),
)

// Similar to above, we must also parse input dates as UTC so the servers running on different time
// zones work correctly
// NOTE(tec27): Typings are now missing this option for some reason?
;(pg.defaults as any).parseInputDatesAsUTC = true

let pool: pg.Pool | undefined
// TODO(tec27): Inject this instead so that tests can initialize it if they need to
if (!isTestRun()) {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL must be set')

  pool = new pg.Pool({ connectionString })
}

export type DbDone = (err?: Error | boolean) => void

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

function isQueryConfig(
  queryTextOrConfig: string | pg.QueryConfig<any>,
): queryTextOrConfig is pg.QueryConfig {
  return !(typeof queryTextOrConfig === 'string')
}

/**
 * A wrapped version of pg.PoolClient that keeps track of queries that are executed and their
 * timings for better error tracking + finding long-running queries.
 */
export class DbClient {
  constructor(private wrappedClient: pg.PoolClient) {}

  async query<R extends pg.QueryResultRow = any, I extends any[] = any[]>(
    queryTextOrConfig: string | pg.QueryConfig<I>,
    values?: I,
  ): Promise<pg.QueryResult<R>> {
    const queryText = isQueryConfig(queryTextOrConfig) ? queryTextOrConfig.text : queryTextOrConfig
    const startTime = Date.now()
    try {
      return await this.wrappedClient.query(queryTextOrConfig, values)
    } catch (error) {
      throw handlePgError(queryText, error)
    } finally {
      const totalTime = Date.now() - startTime
      if (totalTime > SLOW_QUERY_TIME_MS) {
        log.warn(`Slow query [${totalTime}ms]:\n${queryText.trim()}`)
      }
    }
  }
}

const NOOP_DONE = () => {}

/**
 * Retrieves a database client from the pool. If a defined `inputClient` is passed in, it will be
 * returned instead of retrieving a new client (so query functions can easily utilize existing
 * clients, while also being simple to work with if no client is available already).
 */
export async function getDbClient(inputClient?: DbClient): Promise<ClientResult> {
  if (inputClient) {
    return { client: inputClient, done: NOOP_DONE }
  }

  const client = await pool!.connect()
  return { client: new DbClient(client), done: client.release.bind(client) }
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

export default getDbClient
