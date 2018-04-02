import db from '../db'

export async function addEmailVerificationCode(userId, email, code, ip) {
  const query = `
    INSERT INTO email_verifications
    (user_id, email, verification_code, request_time, request_ip)
    VALUES ($1, $2, $3, $4, $5)
  `
  const params = [userId, email, code, new Date(), ip]

  const { client, done } = await db()
  try {
    await client.query(query, params)
  } finally {
    done()
  }
}

export async function getEmailVerificationsCount(id, email) {
  const query = `
    SELECT COUNT(*) AS count
    FROM email_verifications
    WHERE user_id = $1 AND email = $2
  `
  const params = [id, email]

  const { client, done } = await db()
  try {
    const result = await client.query(query, params)
    return result.rows[0].count
  } finally {
    done()
  }
}

export async function useEmailVerificationCode(id, email, code) {
  const query = `
    UPDATE users u
    SET email_verified = TRUE
    FROM email_verifications ev
    WHERE
      ev.user_id = $1 AND
      ev.email = $2 AND
      ev.user_id = u.id AND
      ev.email = u.email AND
      ev.verification_code = $3 AND
      ev.request_time > $4 AND
      u.email_verified = FALSE
    RETURNING *
  `
  const twoDaysAgo = new Date()
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)
  const params = [id, email, code, twoDaysAgo]

  const { client, done } = await db()
  try {
    const result = await client.query(query, params)
    return result.rows.length
  } finally {
    done()
  }
}
