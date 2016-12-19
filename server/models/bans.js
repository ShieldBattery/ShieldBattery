import db from '../db'

export async function ban(userId, length, bannedBy, reason) {
  const { client, done } = await db()
  const startDate = new Date()
  const endDate = new Date()
  endDate.setHours(endDate.getHours() + length)
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
