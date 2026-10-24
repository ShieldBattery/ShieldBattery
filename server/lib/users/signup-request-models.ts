import { SbUserId } from '../../../common/users/sb-user-id'
import db, { DbClient } from '../db'
import { sql } from '../db/sql'

export interface SignupRequest {
  id: string
  nonce: Buffer
  requestHash: Buffer
  expiresAt: Date
  userId?: SbUserId
}

export async function insertSignupRequest(request: SignupRequest): Promise<void> {
  const { client, done } = await db()
  try {
    await client.query(sql`
      DELETE FROM signup_requests WHERE id IN (
        SELECT id FROM signup_requests WHERE expires_at < CURRENT_TIMESTAMP
        ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED
      )
    `)
    await client.query(sql`
      INSERT INTO signup_requests (id, nonce, request_hash, expires_at)
      VALUES (${request.id}, ${request.nonce}, ${request.requestHash}, ${request.expiresAt})
    `)
  } finally {
    done()
  }
}

export async function findSignupRequest(
  id: string,
  withClient?: DbClient,
): Promise<SignupRequest | undefined> {
  const { client, done } = await db(withClient)
  try {
    let query = sql`SELECT id, nonce, request_hash, expires_at, user_id
      FROM signup_requests WHERE id = ${id}`
    if (withClient) query = query.append(sql` FOR UPDATE`)
    const result = await client.query<{
      id: string
      nonce: Buffer
      request_hash: Buffer
      expires_at: Date
      user_id: SbUserId | null
    }>(query)
    const row = result.rows[0]
    return row
      ? {
          id: row.id,
          nonce: row.nonce,
          requestHash: row.request_hash,
          expiresAt: row.expires_at,
          userId: row.user_id ?? undefined,
        }
      : undefined
  } finally {
    done()
  }
}

/** The request row must be locked by the account creation transaction. */
export async function completeSignupRequest(
  client: DbClient,
  id: string,
  userId: SbUserId,
): Promise<void> {
  await client.query(sql`UPDATE signup_requests SET user_id = ${userId} WHERE id = ${id}`)
}
