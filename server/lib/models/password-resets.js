import db from '../db'

export async function addPasswordResetCode(userId, code, ip) {
  const { client, done } = await db()
  const query = `
      INSERT INTO password_resets
      (user_id, reset_code, request_time, request_ip, used)
      VALUES ($1, $2, $3, $4, $5)
  `
  const params = [userId, code, new Date(), ip, false]

  try {
    await client.query(query, params)
  } finally {
    done()
  }
}

export async function usePasswordResetCode(client, username, code) {
  const query = `
    UPDATE password_resets pr
    SET used = TRUE
    FROM users u
    WHERE
      u.name = $1 AND
      u.id = pr.user_id AND
      pr.reset_code = $2 AND
      pr.used = FALSE AND
      pr.request_time > $3
    RETURNING *
  `
  const twoDaysAgo = new Date()
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)
  const params = [username, code, twoDaysAgo]

  const result = await client.query(query, params)
  if (!result.rows.length) throw new Error('No such reset code for user')
}
