import transact from '../db/transaction'

export async function updateOrInsertUserIp(userId, ipAddress) {
  const anHourAgo = new Date()
  anHourAgo.setHours(anHourAgo.getHours() - 1)

  return transact(async function(client) {
    const result = await client.queryPromise(
        'SELECT * FROM user_ips WHERE user_id = $1 AND ip_address = $2 AND last_used >= $3',
        [ userId, ipAddress, anHourAgo ])

    if (result.rows.length > 0) {
      // This user has already made a request within one hour to our website with this ip address
      const mostRecent = result.rows[0]
      return client.queryPromise(
        `UPDATE user_ips SET last_used = $5
        WHERE user_id = $1 AND ip_address = $2 AND first_used = $3 AND last_used = $4`,
        [ mostRecent.user_id, mostRecent.ip_address, mostRecent.first_used, mostRecent.last_used,
          new Date() ])
    } else {
      // We don't have a record of this user visiting with this IP addres in the last hour
      return client.queryPromise(
          'INSERT INTO user_ips (user_id, ip_address, first_used, last_used) SELECT $1, $2, $3, $4',
          [ userId, ipAddress, new Date(), new Date() ])
    }
  })
}
