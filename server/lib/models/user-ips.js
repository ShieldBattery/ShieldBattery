import db from '../db'

const MAX_RETRIES = 5

export async function updateOrInsertUserIp(userId, ipAddress) {
  const { client, done } = await db()
  const curDate = new Date()
  const anHourAgo = new Date()
  anHourAgo.setHours(anHourAgo.getHours() - 1)

  try {
    let caughtErr
    // Attempt to get a row created/updated for this user/IP combo. We decide whether to insert or
    // update based on the results of a SELECT, but since no locks are present, other requests could
    // interleave for a user and insert/update a row in the meantime. If they do, the keys present
    // in the table will cause our request to fail. At that point, we'll re-do the SELECT and retry
    // our logic. If we fail MAX_RETRIES times, we just give up (because this really isn't a life or
    // death thing)
    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        const result = await client.queryPromise(
          `SELECT * FROM user_ips
            WHERE user_id = $1 AND ip_address = $2
            ORDER BY user_ip_counter DESC`,
          [ userId, ipAddress ])

        if (result.rows.length > 0 && result.rows[0].last_used > anHourAgo) {
          // This user has already made a request with this IP address within the last hour, update
          // the previous entry
          return await client.queryPromise(
            `UPDATE user_ips SET last_used = $1
            WHERE user_id = $2 AND ip_address = $3 AND user_ip_counter = $4 AND last_used < $5`,
            [
              curDate,
              result.rows[0].user_id,
              result.rows[0].ip_address,
              result.rows[0].user_ip_counter,
              curDate,
            ])
        } else {
          // We don't have a record of this user visiting with this IP address in the last hour,
          // insert a new row with an increased counter (if the IP previously existed for this
          // user), or with counter = 0 otherwise
          const counter = result.rows.length > 0 ? (result.rows[0].user_ip_counter + 1) : 0
          return await client.queryPromise(
            `INSERT INTO user_ips (user_id, ip_address, first_used, last_used, user_ip_counter)
              VALUES ($1, $2, $3, $4, $5)`,
            [ userId, ipAddress, curDate, curDate, counter ])
        }
      } catch (err) {
        caughtErr = err
      }
    }

    throw caughtErr
  } finally {
    done()
  }
}
