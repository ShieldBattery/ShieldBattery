import db from '../db'

export async function getChannelsForUser(userId) {
  const { client, done } = await db()
  try {
    const result = await client.queryPromise(
        'SELECT channel_name, join_date FROM joined_channels WHERE user_id = $1 ORDER BY join_date',
        [ userId ])
    return result.rows.map(row => ({ channelName: row.channel_name, joinDate: row.join_date }))
  } finally {
    done()
  }
}

export async function getUsersForChannel(channelName) {
  const { client, done } = await db()
  try {
    const result = await client.queryPromise(
        `SELECT u.name, c.join_date
        FROM joined_channels as c INNER JOIN users as u ON c.user_id = u.id
        WHERE c.channel_name = $1
        ORDER BY c.join_date`,
        [ channelName ])
    return result.rows.map(row => ({ userName: row.name, joinDate: row.join_date }))
  } finally {
    done()
  }
}

export async function addUserToChannel(userId, channelName) {
  // TODO(tec27): add a join message as well when this happens (in a transaction)
  const { client, done } = await db()
  try {
    const result = await client.queryPromise(
        `INSERT INTO joined_channels (user_id, channel_name, join_date)
        VALUES ($1, $2, CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
        RETURNING user_id, channel_name, join_date`,
        [ userId, channelName ])
    if (result.rows.length < 1) {
      throw new Error('No rows returned')
    }

    const row = result.rows[0]
    return {
      userId: row.user_id,
      channelName: row.channel_name,
      joinDate: row.join_date,
    }
  } finally {
    done()
  }
}

export async function addMessageToChannel(userId, channelName, messageData) {
  const { client, done } = await db()
  try {
    const result = await client.queryPromise(
        `WITH ins AS (
          INSERT INTO channel_messages (id, user_id, channel_name, sent, data)
          SELECT uuid_generate_v4(), $1, $2, CURRENT_TIMESTAMP AT TIME ZONE 'UTC', $3
          WHERE EXISTS (SELECT 1 FROM joined_channels WHERE user_id = $1 AND channel_name = $2)
          RETURNING id, user_id, channel_name, sent, data
        ) SELECT ins.id, users.name, ins.channel_name, ins.sent, ins.data
        FROM ins INNER JOIN users ON ins.user_id = users.id`,
        [ userId, channelName, JSON.stringify(messageData) ])
    if (result.rows.length < 1) {
      throw new Error('No rows returned')
    }

    const row = result.rows[0]
    return {
      msgId: row.id,
      userName: row.name,
      channelName: row.channel_name,
      sent: row.sent,
      data: row.data
    }
  } finally {
    done()
  }
}

export async function getMessagesForChannel(channelName, userId, limit = 50, beforeDate = -1) {
  const { client, done } = await db()
  const whereClause = 'WHERE m.channel_name = $1 AND m.sent >= joined.join_date' +
      (beforeDate > -1 ? ' AND m.sent < $4' : '')
  const params = [ channelName, userId, limit ]
  if (beforeDate > -1) {
    params.push(new Date(beforeDate))
  }
  const sql = `WITH joined AS (
        SELECT join_date
        FROM joined_channels
        WHERE user_id = $2 AND channel_name = $1
      ), messages AS (
        SELECT m.id, u.name, m.channel_name, m.sent, m.data
        FROM channel_messages as m INNER JOIN users as u ON m.user_id = u.id, joined
        ${whereClause}
        ORDER BY m.sent DESC
        LIMIT $3
      ) SELECT * FROM messages ORDER BY sent ASC`

  try {
    const result = await client.queryPromise(sql, params)

    return result.rows.map(row => ({
      msgId: row.id,
      userName: row.name,
      channelName: row.channel_name,
      sent: row.sent,
      data: row.data,
    }))
  } finally {
    done()
  }
}
