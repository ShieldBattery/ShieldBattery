import db from '../db'
import transact from '../db/transaction'

class ChannelPermissions {
  constructor(props) {
    this.kick = props.kick
    this.ban = props.ban
    this.changeTopic = props.change_topic
    this.togglePrivate = props.toggle_private
    this.editPermissions = props.edit_permissions
  }
}

class Channel {
  constructor(props) {
    this.name = props.name
    this.private = props.private
    this.highTraffic = props.high_traffic
    this.topic = props.topic
    this.password = props.password
  }
}

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

export async function addUserToChannel(userId, channelName, client = null) {
  const fn = async function(client) {
    let columns
    let values
    const params = [ userId, channelName ]

    const channelExists = await findChannel(channelName)
    if (channelExists) {
      // Channel already exists, add a new user to it with no permissions
      columns = '(user_id, channel_name, join_date)'
      values = '($1, $2, CURRENT_TIMESTAMP AT TIME ZONE \'UTC\')'
    } else {
      // Channel doesn't exist, new channel will be added and user added to it with full permissions
      columns = `(user_id, channel_name, join_date, kick, ban, change_topic, toggle_private,
          edit_permissions)`
      values = '($1, $2, CURRENT_TIMESTAMP AT TIME ZONE \'UTC\', $3, $4, $5, $6, $7)'
      params.push(true, true, true, true, true)
    }

    await client.queryPromise(
        `INSERT INTO channels (name) SELECT $1
        WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name=$1)`,
        [ channelName ])

    const result = await client.queryPromise(`INSERT INTO joined_channels ${columns}
        VALUES ${values} RETURNING *`, params)
    if (result.rows.length < 1) {
      throw new Error('No rows returned')
    }

    const {
      user_id: userIdFromDb,
      channel_name: channelNameFromDb,
      join_date: joinDate,
      kick,
      ban,
      change_topic: changeTopic,
      toggle_private: togglePrivate,
      edit_permissions: editPermissions,
    } = result.rows[0]
    return {
      userId: userIdFromDb,
      channelName: channelNameFromDb,
      joinDate,
      channelPermissions: new ChannelPermissions(
          {kick, ban, changeTopic, togglePrivate, editPermissions}),
    }
  }

  if (client) {
    return await fn(client)
  } else {
    return await transact(fn)
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

export async function leaveChannel(userId, channelName) {
  return await transact(async function(client) {
    let result = await client.queryPromise(
        'DELETE FROM joined_channels WHERE user_id = $1 AND channel_name = $2 RETURNING *',
        [ userId, channelName ])
    if (result.rows.length < 1) {
      throw new Error('No rows returned')
    }

    result = await client.queryPromise(
        `DELETE FROM channels WHERE name = $1 AND
        NOT EXISTS (SELECT 1 FROM joined_channels WHERE channel_name = $1)
        RETURNING name`,
        [ channelName ])
    if (result.rows.length > 0) {
      // Channel was deleted; meaning there is no one left in it so there is no one to transfer the
      // ownership to
      return { newOwner: null }
    }

    result = await client.queryPromise(
        'SELECT user_id FROM joined_channels WHERE channel_name = $1 AND edit_permissions = true',
        [ channelName ])
    if (result.rows.length > 0) {
      // The channel still has someone who can edit permissions; no transfer of ownership necessary
      return { newOwner: null }
    }

    result = await client.queryPromise(
        'SELECT name FROM channels WHERE name = $1 AND high_traffic = true',
        [ channelName ])
    if (result.rows.length > 0) {
      // Don't transfer ownership in "high traffic" channels
      return { newOwner: null }
    }

    result = await client.queryPromise(
        `SELECT u.name, c.user_id, c.join_date
        FROM joined_channels as c INNER JOIN users as u ON c.user_id = u.id
        WHERE c.channel_name = $1 AND
          (c.kick = true OR c.ban = true OR c.change_topic = true OR toggle_private = true)
        ORDER BY c.join_date`,
        [ channelName ])
    if (result.rows.length > 0) {
      // Transfer ownership to the user who has joined the channel earliest and has at least some
      // kind of a permission
      await client.queryPromise(
          `UPDATE joined_channels
          SET kick=true, ban=true, change_topic=true, toggle_private=true, edit_permissions=true
          WHERE user_id = $1 AND channel_name = $2`, [ result.rows[0].user_id, channelName ])
      return { newOwner: result.rows[0].name }
    }

    // Transfer ownership to the user who has joined the channel earliest
    result = await client.queryPromise(
        `SELECT u.name, c.user_id, c.join_date
        FROM joined_channels as c INNER JOIN users as u ON c.user_id = u.id
        WHERE c.channel_name = $1
        ORDER BY c.join_date`,
        [ channelName ])

    await client.queryPromise(
        `UPDATE joined_channels
        SET kick=true, ban=true, change_topic=true, toggle_private=true, edit_permissions=true
        WHERE user_id = $1 AND channel_name = $2`, [ result.rows[0].user_id, channelName ])
    return { newOwner: result.rows[0].name }
  })
}


export async function findChannel(channelName) {
  const { client, done } = await db()
  try {
    const result =
        await client.queryPromise('SELECT * FROM channels WHERE name = $1', [ channelName ])
    return result.rows.length < 1 ? null : new Channel(result.rows[0])
  } finally {
    done()
  }
}
