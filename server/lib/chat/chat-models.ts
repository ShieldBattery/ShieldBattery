import sql, { SQLStatement } from 'sql-template-strings'
import db, { DbClient } from '../db'
import transact from '../db/transaction'
import { Dbify } from '../db/types'

export interface Channel {
  name: string
  private: boolean
  highTraffic: boolean
  topic: string
  password: string
}

type DbChannel = Dbify<Omit<Channel, 'name'> & { channelName: Channel['name'] }>

function fromDbChannel(result: Readonly<DbChannel>): Channel {
  return {
    name: result.channel_name,
    private: result.private,
    highTraffic: result.high_traffic,
    topic: result.topic,
    password: result.password,
  }
}

export interface ChannelPermissions {
  kick: boolean
  ban: boolean
  changeTopic: boolean
  togglePrivate: boolean
  editPermissions: boolean
}

export interface ChannelUser {
  id: number
  name: string
  joinDate: Date
  permissions: ChannelPermissions
}

type DbChannelUser = Dbify<
  Omit<ChannelUser, 'id' | 'name'> & { userId: ChannelUser['id']; userName: ChannelUser['name'] }
>

function fromDbChannelUser(result: Readonly<DbChannelUser>): ChannelUser {
  return {
    id: result.user_id,
    name: result.user_name,
    joinDate: result.join_date,
    permissions: result.permissions,
  }
}

interface JoinedChannel {
  channel: Channel
  user: ChannelUser
}

/**
 * Gets all of the joined chat channels for a given user, along with user's info for each of those
 * channels. Some of the user's info (e.g. id, name) will be the same for each channel, and some
 * (e.g. permissions, join date) will be different.
 */
export async function getJoinedChannels(userId: number): Promise<JoinedChannel[]> {
  const { client, done } = await db()
  try {
    const result = await client.query<DbChannel & DbChannelUser>(sql`
      SELECT c.name AS channel_name, c.private, c.high_traffic, c.topic, c.password,
        u.id AS user_id, u.name AS user_name, j.join_date, json_build_object('kick', j.kick, 'ban',
        j.ban, 'changeTopic', j.change_topic, 'togglePrivate', j.toggle_private, 'editPermissions',
        j.edit_permissions) AS permissions
      FROM joined_channels AS j
        INNER JOIN channels as c ON j.channel_name = c.name
        INNER JOIN users as u ON j.user_id = u.id
      WHERE j.user_id = ${userId}
      ORDER BY j.join_date;
    `)

    return result.rows.map(row => ({
      channel: fromDbChannel(row),
      user: fromDbChannelUser(row),
    }))
  } finally {
    done()
  }
}

/**
 * Gets all of the joined users in a given chat channel, along with their permissions for that
 * channel.
 */
export async function getUsersForChannel(channelName: string): Promise<ChannelUser[]> {
  const { client, done } = await db()
  try {
    const result = await client.query<DbChannelUser>(sql`
      SELECT u.id AS user_id, u.name AS user_name, c.join_date, json_build_object('kick', c.kick,
        'ban', c.ban, 'changeTopic', c.change_topic, 'togglePrivate', c.toggle_private,
        'editPermissions', c.edit_permissions) AS permissions
      FROM joined_channels as c INNER JOIN users as u ON c.user_id = u.id
      WHERE c.channel_name = ${channelName}
      ORDER BY c.join_date;
    `)

    return result.rows.map(row => fromDbChannelUser(row))
  } finally {
    done()
  }
}

/**
 * Adds a provided user to the provided chat channel. If a channel doesn't already exists, it is
 * created and the user is added with full permissions to it (effectively making them the "owner" of
 * that chat channel). If a user is already joined in the given channel, the function will throw an
 * error.
 *
 * The function optionally receives the third argument of a `DbClient` type which executes the query
 * with the given client.
 */
export async function addUserToChannel(
  userId: number,
  channelName: string,
  client?: DbClient,
): Promise<JoinedChannel> {
  const doIt = async (client: DbClient) => {
    let channel = await findChannel(channelName)
    const channelExisted = !!channel
    if (!channel) {
      const result = await client.query<DbChannel>(sql`
        INSERT INTO channels (name)
        VALUES (${channelName})
        RETURNING *, name AS channel_name;
      `)

      channel = fromDbChannel(result.rows[0])
    }

    let query: SQLStatement
    if (channelExisted) {
      query = sql`
        INSERT INTO joined_channels (user_id, channel_name, join_date)
        VALUES (${userId}, ${channelName}, CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
        RETURNING *
      `
    } else {
      // Users joining a new channel get full permissions
      query = sql`
        INSERT INTO joined_channels (user_id, channel_name, join_date, kick, ban, change_topic,
          toggle_private, edit_permissions)
        VALUES (${userId}, ${channelName}, CURRENT_TIMESTAMP AT TIME ZONE 'UTC', true, true, true,
          true, true)
        RETURNING *
      `
    }

    const result = await client.query<DbChannelUser>(
      sql`
        WITH ins AS (`.append(query).append(sql`)
        SELECT u.id AS user_id, u.name AS user_name, ins.join_date, json_build_object('kick',
          ins.kick, 'ban', ins.ban, 'changeTopic', ins.change_topic, 'togglePrivate',
          ins.toggle_private, 'editPermissions', ins.edit_permissions) AS permissions
        FROM ins INNER JOIN users as u ON ins.user_id = u.id;
      `),
    )

    return {
      channel,
      user: fromDbChannelUser(result.rows[0]),
    }
  }

  if (client) {
    return doIt(client)
  } else {
    return transact(doIt)
  }
}

export interface DbChatMessage {
  msgId: string
  userName: string
  channelName: string
  sent: Date
  // TODO(tec27): this can be more strongly typed
  data: Record<string, unknown>
}

// TOOD(tec27): messageData can be more strongly typed
export async function addMessageToChannel(
  userId: number,
  channelName: string,
  messageData: Record<string, unknown>,
): Promise<DbChatMessage> {
  const { client, done } = await db()
  try {
    const result = await client.query(
      sql`
      WITH ins AS (
        INSERT INTO channel_messages (id, user_id, channel_name, sent, data)
        SELECT uuid_generate_v4(), ${userId}, ${channelName},
          CURRENT_TIMESTAMP AT TIME ZONE 'UTC', ${messageData}
        WHERE EXISTS (
          SELECT 1 FROM joined_channels WHERE user_id = ${userId} AND channel_name = ${channelName}
        )
        RETURNING id, user_id, channel_name, sent, data
      )
      SELECT ins.id, users.name, ins.channel_name, ins.sent, ins.data
      FROM ins INNER JOIN users ON ins.user_id = users.id`,
    )
    if (result.rows.length < 1) {
      throw new Error('No rows returned')
    }

    const row = result.rows[0]
    return {
      msgId: row.id,
      userName: row.name,
      channelName: row.channel_name,
      sent: row.sent,
      data: row.data,
    }
  } finally {
    done()
  }
}

export async function getMessagesForChannel(
  channelName: string,
  userId: number,
  limit = 50,
  beforeDate?: Date,
): Promise<DbChatMessage[]> {
  const { client, done } = await db()

  const query = sql`WITH joined AS (
        SELECT join_date
        FROM joined_channels
        WHERE user_id = ${userId} AND channel_name = ${channelName}
      ), messages AS (
        SELECT m.id, u.name, m.channel_name, m.sent, m.data
        FROM channel_messages as m INNER JOIN users as u ON m.user_id = u.id, joined
        WHERE m.channel_name = ${channelName} AND m.sent >= joined.join_date `

  if (beforeDate !== undefined) {
    query.append(sql`AND m.sent < ${beforeDate}`)
  }

  query.append(sql`
        ORDER BY m.sent DESC
        LIMIT ${limit}
      ) SELECT * FROM messages ORDER BY sent ASC`)

  try {
    const result = await client.query(query)

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

export interface LeaveChannelResult {
  /**
   * The new owner of the channel, or null if the channel ownership has been left unchanged.
   */
  newOwner: string | null
}

export async function leaveChannel(
  userId: number,
  channelName: string,
): Promise<LeaveChannelResult> {
  return transact(async function (client) {
    let result = await client.query(sql`
      DELETE FROM joined_channels
      WHERE user_id = ${userId} AND channel_name = ${channelName}
      RETURNING *`)
    if (result.rowCount < 1) {
      throw new Error('No rows returned')
    }

    result = await client.query(sql`
      DELETE FROM channels
      WHERE name = ${channelName} AND
        NOT EXISTS (SELECT 1 FROM joined_channels WHERE channel_name = ${channelName})
      RETURNING name`)
    if (result.rowCount > 0) {
      // Channel was deleted; meaning there is no one left in it so there is no one to transfer the
      // ownership to
      return { newOwner: null }
    }

    result = await client.query(sql`
      SELECT user_id FROM joined_channels
      WHERE channel_name = ${channelName} AND edit_permissions = true`)
    if (result.rowCount > 0) {
      // The channel still has someone who can edit permissions; no transfer of ownership necessary
      return { newOwner: null }
    }

    result = await client.query(sql`
      SELECT name FROM channels
      WHERE name = ${channelName} AND high_traffic = true`)
    if (result.rowCount > 0) {
      // Don't transfer ownership in "high traffic" channels
      return { newOwner: null }
    }

    result = await client.query(sql`
      SELECT u.name, c.user_id, c.join_date
      FROM joined_channels as c INNER JOIN users as u ON c.user_id = u.id
      WHERE c.channel_name = ${channelName} AND
        (c.kick = true OR c.ban = true OR c.change_topic = true OR toggle_private = true)
      ORDER BY c.join_date`)
    if (result.rowCount > 0) {
      // Transfer ownership to the user who has joined the channel earliest and has at least some
      // kind of a permission
      await client.query(sql`
        UPDATE joined_channels
        SET kick=true, ban=true, change_topic=true, toggle_private=true, edit_permissions=true
        WHERE user_id = ${result.rows[0].user_id} AND channel_name = ${channelName}`)
      return { newOwner: result.rows[0].name }
    }

    // Transfer ownership to the user who has joined the channel earliest
    result = await client.query(sql`
      SELECT u.name, c.user_id, c.join_date
      FROM joined_channels as c INNER JOIN users as u ON c.user_id = u.id
      WHERE c.channel_name = ${channelName}
      ORDER BY c.join_date`)

    await client.query(sql`
      UPDATE joined_channels
      SET kick=true, ban=true, change_topic=true, toggle_private=true, edit_permissions=true
      WHERE user_id = ${result.rows[0].user_id} AND channel_name = ${channelName}`)
    return { newOwner: result.rows[0].name }
  })
}

/**
 * Finds a chat channel with a given name and returns it with original casing if found; otherwise it
 * returns a `null`.
 */
export async function findChannel(channelName: string): Promise<Channel | null> {
  const { client, done } = await db()
  try {
    const result = await client.query<DbChannel>(sql`
      SELECT *, name AS channel_name
      FROM channels
      WHERE name = ${channelName};
    `)

    return result.rowCount < 1 ? null : fromDbChannel(result.rows[0])
  } finally {
    done()
  }
}
