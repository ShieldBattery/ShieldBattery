import db from './index'

export default async function transact(next) {
  const { client, done } = await db()
  try {
    await client.queryPromise('BEGIN')
  } catch (err) {
    await rollbackFor(err, client, done)
  }

  try {
    const result = await next(client)
    await client.queryPromise('COMMIT')
    done()
    return result
  } catch (err) {
    await rollbackFor(err, client, done)
  }
  return undefined
}

async function rollbackFor(err, client, done) {
  try {
    await client.queryPromise('ROLLBACK')
  } catch (err) {
    done(err)
    throw err
  }

  done()
  throw err
}
