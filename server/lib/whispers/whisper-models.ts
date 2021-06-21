import sql from 'sql-template-strings'
import { User } from '../../../common/users/user-info'
import { WhisperMessageData } from '../../../common/whispers'
import db from '../db'
import { Dbify } from '../db/types'

export interface WhisperSessionEntry {
  targetId: number
  targetName: string
}

type DbWhisperSessionEntry = Dbify<WhisperSessionEntry>

export async function getWhisperSessionsForUser(userId: number): Promise<WhisperSessionEntry[]> {
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

export async function startWhisperSession(userId: number, targetUserId: number): Promise<void> {
  const { client, done } = await db()
  try {
    await client.query(sql`
      WITH ut AS (
        SELECT u.id AS user_id, t.id AS target_user_id
        FROM users AS u, users AS t
        WHERE u.id = ${userId} AND t.id = ${targetUserId}
      )
      INSERT INTO whisper_sessions (user_id, target_user_id, start_date)
      SELECT ut.user_id, ut.target_user_id, CURRENT_TIMESTAMP AT TIME ZONE 'UTC' FROM ut
      WHERE NOT EXISTS (
        SELECT 1
        FROM whisper_sessions
        WHERE user_id = ut.user_id AND target_user_id = ut.target_user_id
      );
    `)
  } finally {
    done()
  }
}

export async function closeWhisperSession(userId: number, targetId: number): Promise<void> {
  const { client, done } = await db()
  try {
    const result = await client.query(sql`
      WITH tid AS (
        SELECT t.id AS target_user_id
        FROM users AS t
        WHERE t.id = ${targetId}
      )
      DELETE FROM whisper_sessions
      WHERE user_id = ${userId} AND target_user_id = (SELECT target_user_id FROM tid);
    `)
    if (result.rowCount < 1) {
      throw new Error('No rows deleted')
    }
  } finally {
    done()
  }
}

export interface WhisperMessage {
  id: string
  from: User
  to: User
  sent: Date
  data: WhisperMessageData
}

interface FromUser {
  fromId: number
  fromName: string
}

interface ToUser {
  toId: number
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
  fromId: number,
  toId: number,
  messageData: WhisperMessageData,
): Promise<WhisperMessage> {
  const { client, done } = await db()
  try {
    const result = await client.query<DbWhisperMessage>(sql`
      WITH tid AS (
        SELECT t.id AS to_id
        FROM users AS t
        WHERE t.id = ${toId}
      ), ins AS (
        INSERT INTO whisper_messages (id, from_id, to_id, sent, data)
        SELECT uuid_generate_v4(), ${fromId}, tid.to_id,
          CURRENT_TIMESTAMP AT TIME ZONE 'UTC', ${messageData}
        FROM tid
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
  userId1: number,
  userId2: number,
  limit = 50,
  beforeDate?: Date,
): Promise<WhisperMessage[]> {
  const { client, done } = await db()

  const query = sql`
    WITH u AS (
      SELECT u1.id AS user1_id, u2.id AS user2_id
      FROM users AS u1, users AS u2
      WHERE u1.id = ${userId1} AND u2.id = ${userId2}
    ), messages AS (
      SELECT m.id, u_from.id AS from_id, u_from.name AS from_name, u_to.id AS to_id,
        u_to.name AS to_name, m.sent, m.data
      FROM whisper_messages AS m
      INNER JOIN users AS u_from ON m.from_id = u_from.id
      INNER JOIN users AS u_to ON m.to_id = u_to.id, u
      WHERE (
        (m.from_id = u.user1_id AND m.to_id = u.user2_id) OR
        (m.from_id = u.user2_id AND m.to_id = u.user1_id)
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
