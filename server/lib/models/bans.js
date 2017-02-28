import db from '../db'

export async function getBanHistory(userId) {
  const query =
    `SELECT start_time, end_time, u.name AS banned_by_name, reason FROM user_bans bans
    INNER JOIN users u ON bans.banned_by = u.id WHERE bans.user_id = $1
    ORDER BY end_time DESC`
  const params = [ userId ]

  const { client, done } = await db()
  try {
    const result = await client.queryPromise(query, params)

    return result.rows.map(row => ({
      startTime: row.start_time,
      endTime: row.end_time,
      bannedBy: row.banned_by_name,
      reason: row.reason,
    }))
  } finally {
    done()
  }
}

export async function banUser(userId, bannedBy, banLengthHours, reason) {
  const { client, done } = await db()
  const startDate = new Date()
  const endDate = new Date()
  endDate.setHours(endDate.getHours() + banLengthHours)
  const params = [ userId, startDate, endDate, bannedBy ]
  if (reason) {
    params.push(reason)
  }

  try {
    const result = await client.queryPromise(
        `WITH ins AS (
          INSERT INTO user_bans (user_id, start_time, end_time, banned_by, reason)
          VALUES ($1, $2, $3, $4, $5) RETURNING *
        ) SELECT ins.start_time, ins.end_time, u.name AS banned_by_name, ins.reason FROM ins
        INNER JOIN users u ON ins.banned_by = u.id`, params)

    return {
      startTime: result.rows[0].start_time,
      endTime: result.rows[0].end_time,
      bannedBy: result.rows[0].banned_by_name,
      reason: result.rows[0].reason,
    }
  } finally {
    done()
  }
}

export async function isUserBanned(userId) {
  const { client, done } = await db()
  const now = new Date()

  try {
    const result = await client.queryPromise(
        'SELECT 1 FROM user_bans WHERE user_id = $1 AND end_time > $2 AND start_time <= $2',
        [ userId, now ])
    return !!result.rows.length
  } finally {
    done()
  }
}
