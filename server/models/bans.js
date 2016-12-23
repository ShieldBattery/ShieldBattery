import db from '../db'

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
    await client.queryPromise(
        `INSERT INTO user_bans (user_id, start_time, end_time, banned_by, reason)
        VALUES ($1, $2, $3, $4, $5)`, params)
  } finally {
    done()
  }
}

export async function isUserBanned(userId) {
  const { client, done } = await db()
  const now = new Date()

  try {
    const result = await client.queryPromise(
        'SELECT * FROM user_bans WHERE end_time > $1 AND start_time <= $1',
        [ now ])
    return !!result.rows.length
  } finally {
    done()
  }
}
