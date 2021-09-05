import db, { DbClient, DbDone } from './index'

export default async function transact<T>(next: (client: DbClient) => Promise<T>): Promise<T> {
  const { client, done } = await db()
  try {
    await client.query('BEGIN')
  } catch (err) {
    // This will re-throw err
    await rollbackFor(err, client, done)
  }

  try {
    const result = await next(client)
    await client.query('COMMIT')
    done()
    return result
  } catch (err) {
    await rollbackFor(err, client, done)
  }
  // NOTE(tec27): This return is never actually hit, but makes the linter happy
  return undefined as any as T
}

async function rollbackFor(err: unknown, client: DbClient, done: DbDone) {
  try {
    await client.query('ROLLBACK')
  } catch (rollbackErr) {
    done(rollbackErr)
    throw rollbackErr
  }

  done()
  throw err
}
