import db from '../db'
import transact from '../db/transaction'

// transactionFn is a function() => Promise, which will be awaited inside the DB transaction. If it
// is rejected, the transaction will be rolled back.
export async function addPatch(hashStr, filename, versionDesc, transactionFn) {
  return await transact(async client => {
    const query = `
      INSERT INTO starcraft_patches (hash, filename, version_desc)
      VALUES ($1, $2, $3) RETURNING *
    `
    const params = [
      Buffer.from(hashStr, 'hex'),
      filename,
      versionDesc,
    ]

    const [result, ] = await Promise.all([
      client.query(query, params),
      transactionFn(),
    ])

    const row = result.rows[0]
    return {
      hash: row.hash,
      filename: row.filename,
      versionDesc: row.version_desc
    }
  })
}

export async function patchExists(hashStr, filename) {
  const query = `
    SELECT 1 FROM starcraft_patches
    WHERE hash = $1 AND filename = $2
  `
  const params = [
    Buffer.from(hashStr, 'hex'),
    filename,
  ]

  const { client, done } = await db()
  try {
    const result = await client.query(query, params)
    return result.rows.length > 0
  } finally {
    done()
  }
}
