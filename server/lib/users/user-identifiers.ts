import sql from 'sql-template-strings'
import { SbUserId } from '../../../common/users/sb-user'
import db, { DbClient } from '../db'
import { Dbify } from '../db/types'

interface UserIdentifier {
  userId: SbUserId
  identifierType: number
  identifierHash: Buffer
  firstUsed: Date
  lastUsed: Date
  timesSeen: number
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type DbUserIdentifier = Dbify<UserIdentifier>

export async function upsertUserIdentifiers(
  userId: SbUserId,
  identifiers: ReadonlyArray<[type: number, hash: Buffer]>,
  withClient?: DbClient,
): Promise<void> {
  if (!identifiers.length) {
    return
  }

  const { client, done } = await db(withClient)
  try {
    const query = sql`
      INSERT INTO user_identifiers
      (user_id, identifier_type, identifier_hash, first_used, last_used, times_seen)
      VALUES
    `

    for (let i = 0; i < identifiers.length; i++) {
      query.append(i !== 0 ? sql`, ` : sql` `)
      query.append(sql`(${userId}, ${identifiers[i][0]}, ${identifiers[i][1]}, NOW(), NOW(), 1)`)
    }

    query.append(sql`
      ON CONFLICT (user_id, identifier_type, identifier_hash)
      DO UPDATE
      SET last_used = NOW(),
      times_seen = EXCLUDED.times_seen + 1
    `)

    await client.query(query)
  } finally {
    done()
  }
}
