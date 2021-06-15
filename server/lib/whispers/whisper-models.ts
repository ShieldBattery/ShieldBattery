import sql from 'sql-template-strings'
import { WhisperMessageData } from '../../../common/whispers'
import db from '../db'

export interface WhisperSessionEntry {
  targetUserId: number
  targetUserName: string
}

export async function getWhisperSessionsForUser(userId: number): Promise<WhisperSessionEntry[]> {
  const { client, done } = await db()
  try {
    const result = await client.query(sql`
      SELECT u.name AS target_name, u.id AS target_id FROM whisper_sessions
      INNER JOIN users AS u ON target_user_id = u.id
      WHERE user_id = ${userId}
      ORDER BY start_date;
    `)
    return result.rows.map(row => ({
      targetUserId: row.target_id,
      targetUserName: row.target_name,
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

export async function closeWhisperSession(userId: number, targetUserName: string): Promise<void> {
  const { client, done } = await db()
  try {
    const result = await client.query(sql`
      WITH tid AS (
        SELECT t.id AS target_user_id
        FROM users AS t
        WHERE t.name = ${targetUserName}
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

export interface DbWhisperMessage {
  msgId: string
  from: string
  to: string
  sent: Date
  data: WhisperMessageData
}

export async function addMessageToWhisper(
  fromId: number,
  toName: string,
  messageData: WhisperMessageData,
): Promise<DbWhisperMessage> {
  const { client, done } = await db()
  try {
    const result = await client.query(sql`
      WITH tid AS (
        SELECT t.id AS to_id
        FROM users AS t
        WHERE t.name = ${toName}
      ), ins AS (
        INSERT INTO whisper_messages (id, from_id, to_id, sent, data)
        SELECT uuid_generate_v4(), ${fromId}, tid.to_id,
          CURRENT_TIMESTAMP AT TIME ZONE 'UTC', ${messageData}
        FROM tid
        RETURNING id, from_id, to_id, sent, data
      )
      SELECT ins.id, u_from.name AS from, u_to.name AS to, ins.sent, ins.data FROM ins
      INNER JOIN users AS u_from ON ins.from_id = u_from.id
      INNER JOIN users AS u_to ON ins.to_id = u_to.id;
    `)
    if (result.rows.length < 1) {
      throw new Error('No rows returned')
    }

    const row = result.rows[0]
    return {
      msgId: row.id,
      from: row.from,
      to: row.to,
      sent: row.sent,
      data: row.data,
    }
  } finally {
    done()
  }
}

export async function getMessagesForWhisperSession(
  userName1: string,
  userName2: string,
  limit = 50,
  beforeDate?: Date,
): Promise<DbWhisperMessage[]> {
  const { client, done } = await db()

  const query = sql`
    WITH u AS (
      SELECT u1.id AS user1_id, u2.id AS user2_id
      FROM users AS u1, users AS u2
      WHERE u1.name = ${userName1} AND u2.name = ${userName2}
    ), messages AS (
      SELECT m.id, u_from.name AS from, u_to.name AS to, m.sent, m.data
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
    const result = await client.query(query)

    return result.rows.map(row => ({
      msgId: row.id,
      from: row.from,
      to: row.to,
      sent: row.sent,
      data: row.data,
    }))
  } finally {
    done()
  }
}
