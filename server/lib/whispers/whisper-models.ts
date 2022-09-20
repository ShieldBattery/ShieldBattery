import sql from 'sql-template-strings'
import { SbUser, SbUserId } from '../../../common/users/sb-user'
import { WhisperMessageData } from '../../../common/whispers'
import db from '../db'
import { Dbify } from '../db/types'

export interface WhisperSessionEntry {
  targetId: SbUserId
  targetName: string
}

type DbWhisperSessionEntry = Dbify<WhisperSessionEntry>

export async function getWhisperSessionsForUser(userId: SbUserId): Promise<WhisperSessionEntry[]> {
  const { client, done } = await db()
  try {
    const result = await client.query<DbWhisperSessionEntry>(sql`
      SELECT u.name AS target_name, u.id AS target_id FROM whisper_sessions
      INNER JOIN users AS u ON target_user_id = u.id
      WHERE user_id = ${userId}
      ORDER BY start_date;
    `)
    return result.rows.map(row => ({
      targetId: row.target_id,
      targetName: row.target_name,
    }))
  } finally {
    done()
  }
}

export async function startWhisperSession(userId: SbUserId, targetUserId: SbUserId): Promise<void> {
  const { client, done } = await db()
  try {
    await client.query(sql`
      INSERT INTO whisper_sessions (user_id, target_user_id, start_date)
      VALUES (${userId}, ${targetUserId}, CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
      ON CONFLICT DO NOTHING;
    `)
  } finally {
    done()
  }
}

export async function closeWhisperSession(userId: SbUserId, targetId: SbUserId): Promise<boolean> {
  const { client, done } = await db()
  try {
    const result = await client.query(sql`
      DELETE FROM whisper_sessions
      WHERE user_id = ${userId} AND target_user_id = ${targetId};
    `)
    return result.rowCount > 0
  } finally {
    done()
  }
}

export interface WhisperMessage {
  id: string
  from: SbUser
  to: SbUser
  sent: Date
  data: WhisperMessageData
}

interface FromUser {
  fromId: SbUserId
  fromName: string
}

interface ToUser {
  toId: SbUserId
  toName: string
}

type DbWhisperMessage = Dbify<WhisperMessage & FromUser & ToUser>

function convertMessageFromDb(dbMessage: DbWhisperMessage): WhisperMessage {
  return {
    id: dbMessage.id,
    from: {
      id: dbMessage.from_id,
      name: dbMessage.from_name,
    },
    to: {
      id: dbMessage.to_id,
      name: dbMessage.to_name,
    },
    sent: dbMessage.sent,
    data: dbMessage.data,
  }
}

export async function addMessageToWhisper(
  fromId: SbUserId,
  toId: SbUserId,
  messageData: WhisperMessageData,
): Promise<WhisperMessage> {
  const { client, done } = await db()
  try {
    const result = await client.query<DbWhisperMessage>(sql`
      WITH ins AS (
        INSERT INTO whisper_messages (id, from_id, to_id, sent, data)
        VALUES (uuid_generate_v4(), ${fromId}, ${toId},
          CURRENT_TIMESTAMP AT TIME ZONE 'UTC', ${messageData})
        RETURNING id, from_id, to_id, sent, data
      )
      SELECT ins.id, u_from.id AS from_id, u_from.name AS from_name, u_to.id AS to_id,
        u_to.name AS to_name, ins.sent, ins.data FROM ins
      INNER JOIN users AS u_from ON ins.from_id = u_from.id
      INNER JOIN users AS u_to ON ins.to_id = u_to.id;
    `)
    if (result.rows.length < 1) {
      throw new Error('No rows returned')
    }

    return convertMessageFromDb(result.rows[0])
  } finally {
    done()
  }
}

export async function getMessagesForWhisperSession(
  userId1: SbUserId,
  userId2: SbUserId,
  limit = 50,
  beforeDate?: Date,
): Promise<WhisperMessage[]> {
  const { client, done } = await db()

  const query = sql`
    WITH messages AS (
      SELECT m.id, m.from_id AS from_id, u_from.name AS from_name, m.to_id AS to_id,
        u_to.name AS to_name, m.sent, m.data
      FROM whisper_messages AS m
      INNER JOIN users AS u_from ON m.from_id = u_from.id
      INNER JOIN users AS u_to ON m.to_id = u_to.id
      WHERE (
        (m.from_id = ${userId1} AND m.to_id = ${userId2}) OR
        (m.from_id = ${userId2} AND m.to_id = ${userId1})
      ) `

  if (beforeDate !== undefined) {
    query.append(sql`AND m.sent < ${beforeDate}`)
  }

  query.append(sql`
      ORDER BY m.sent DESC
      LIMIT ${limit}
    )
    SELECT *
    FROM messages
    ORDER BY sent ASC;
  `)

  try {
    const result = await client.query<DbWhisperMessage>(query)

    return result.rows.map(row => convertMessageFromDb(row))
  } finally {
    done()
  }
}
