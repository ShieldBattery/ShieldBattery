import db from '../db'

export async function getWhisperSessionsForUser(userId) {
  const { client, done } = await db()
  try {
    const result = await client.queryPromise(
      `SELECT u.name AS target_user FROM whisper_sessions
        INNER JOIN users AS u ON target_user_id = u.id
        WHERE user_id = $1 ORDER BY start_date`,
      [userId],
    )
    return result.rows.map(row => row.target_user)
  } finally {
    done()
  }
}

export async function startWhisperSession(user, targetUser) {
  const { client, done } = await db()
  try {
    await client.queryPromise(
      `WITH ut AS (
          SELECT u.id AS user_id, t.id AS target_user_id
          FROM users AS u, users AS t
          WHERE u.name = $1 AND t.name = $2
        ) INSERT INTO whisper_sessions (user_id, target_user_id, start_date)
        SELECT ut.user_id, ut.target_user_id, CURRENT_TIMESTAMP AT TIME ZONE 'UTC' FROM ut
        WHERE NOT EXISTS (SELECT 1 FROM whisper_sessions
          WHERE user_id = ut.user_id AND target_user_id = ut.target_user_id)`,
      [user, targetUser],
    )
  } finally {
    done()
  }
}

export async function closeWhisperSession(userId, targetUser) {
  const { client, done } = await db()
  try {
    const result = await client.queryPromise(
      `WITH tid AS (
          SELECT t.id AS target_user_id FROM users AS t WHERE t.name = $2
        ) DELETE FROM whisper_sessions WHERE user_id = $1 AND target_user_id =
          (SELECT target_user_id FROM tid)`,
      [userId, targetUser],
    )
    if (result.rowCount < 1) {
      throw new Error('No rows deleted')
    }
  } finally {
    done()
  }
}

export async function addMessageToWhisper(fromId, toName, messageData) {
  const { client, done } = await db()
  try {
    const result = await client.queryPromise(
      `WITH tid AS (
          SELECT t.id AS to_id FROM users AS t WHERE t.name = $2
        ), ins AS (
          INSERT INTO whisper_messages (id, from_id, to_id, sent, data)
          SELECT uuid_generate_v4(), $1, tid.to_id, CURRENT_TIMESTAMP AT TIME ZONE 'UTC', $3
          FROM tid RETURNING id, from_id, to_id, sent, data
        ) SELECT ins.id, u_from.name AS from, u_to.name AS to, ins.sent, ins.data FROM ins
        INNER JOIN users AS u_from ON ins.from_id = u_from.id
        INNER JOIN users AS u_to ON ins.to_id = u_to.id`,
      [fromId, toName, JSON.stringify(messageData)],
    )
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

export async function getMessagesForWhisperSession(user1, user2, limit = 50, beforeDate = -1) {
  const { client, done } = await db()
  const whereClause =
    'WHERE ((m.from_id = u.user1_id AND m.to_id = u.user2_id) OR' +
    ' (m.from_id = u.user2_id AND m.to_id = u.user1_id))' +
    (beforeDate > -1 ? ' AND m.sent < $4' : '')
  const params = [user1, user2, limit]
  if (beforeDate > -1) {
    params.push(new Date(beforeDate))
  }
  const sql = `WITH u AS (
          SELECT u1.id AS user1_id, u2.id AS user2_id
          FROM users AS u1, users AS u2
          WHERE u1.name = $1 AND u2.name = $2
      ), messages AS (
        SELECT m.id, u_from.name AS from, u_to.name AS to, m.sent, m.data
        FROM whisper_messages AS m
        INNER JOIN users AS u_from ON m.from_id = u_from.id
        INNER JOIN users AS u_to ON m.to_id = u_to.id, u
        ${whereClause}
        ORDER BY m.sent DESC
        LIMIT $3
      ) SELECT * FROM messages ORDER BY sent ASC`

  try {
    const result = await client.queryPromise(sql, params)

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
