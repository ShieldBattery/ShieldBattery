import sql, { SQLStatement } from 'sql-template-strings'
import { ChatUser, ServerChatMessageType } from '../../../common/chat'
import { SbUserId } from '../../../common/users/user-info'
import db, { DbClient } from '../db'
import transact from '../db/transaction'
import { Dbify } from '../db/types'

export interface UserChannelsEntry {
  channelName: string
  joinDate: Date
}

type DbUserChannelsEntry = Dbify<UserChannelsEntry>

export async function getChannelsForUser(userId: SbUserId): Promise<UserChannelsEntry[]> {
  const { client, done } = await db()
  try {
    const result = await client.query<DbUserChannelsEntry>(sql`
      SELECT channel_name, join_date
      FROM joined_channels
      WHERE user_id = ${userId}
      ORDER BY join_date`)
    return result.rows.map(row => ({ channelName: row.channel_name, joinDate: row.join_date }))
  } finally {
    done()
  }
}

export interface ChannelUsersEntry {
  userId: SbUserId
  userName: string
  joinDate: Date
}

type DbChannelUsersEntry = Dbify<ChannelUsersEntry>

export async function getUsersForChannel(channelName: string): Promise<ChannelUsersEntry[]> {
  const { client, done } = await db()
  try {
    const result = await client.query<DbChannelUsersEntry>(sql`
      SELECT u.id AS user_id, u.name AS user_name, c.join_date
      FROM joined_channels as c INNER JOIN users as u ON c.user_id = u.id
      WHERE c.channel_name = ${channelName}
      ORDER BY c.join_date`)
    return result.rows.map(row => ({
      userId: row.user_id,
      userName: row.user_name,
      joinDate: row.join_date,
    }))
  } finally {
    done()
  }
}

export interface ChannelPermissions {
  kick: boolean
  ban: boolean
  changeTopic: boolean
  togglePrivate: boolean
  editPermissions: boolean
}

export interface JoinedChannel {
  userId: SbUserId
  userName: string
  channelName: string
  joinDate: Date
  channelPermissions: ChannelPermissions
}

type DbJoinedChannel = Dbify<JoinedChannel & ChannelPermissions>

function convertJoinedChannelFromDb(props: DbJoinedChannel): JoinedChannel {
  return {
    userId: props.user_id,
    userName: props.user_name,
    channelName: props.channel_name,
    joinDate: props.join_date,
    channelPermissions: {
      kick: props.kick,
      ban: props.ban,
      changeTopic: props.change_topic,
      togglePrivate: props.toggle_private,
      editPermissions: props.edit_permissions,
    },
  }
}

export async function getJoinedChannelForUser(
  userId: SbUserId,
  channelName: string,
): Promise<JoinedChannel | null> {
  const { client, done } = await db()
  try {
    const result = await client.query<DbJoinedChannel>(sql`
      SELECT *
      FROM joined_channels
      WHERE user_id = ${userId} AND channel_name = ${channelName};
    `)

    return result.rowCount < 1 ? null : convertJoinedChannelFromDb(result.rows[0])
  } finally {
    done()
  }
}

export async function addUserToChannel(
  userId: SbUserId,
  channelName: string,
  client?: DbClient,
): Promise<JoinedChannel> {
  const doIt = async (client: DbClient) => {
    const channelExists = await findChannel(channelName)
    await client.query(sql`INSERT INTO channels (name) SELECT ${channelName}
        WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name=${channelName})`)

    let query: SQLStatement
    if (channelExists) {
      query = sql`
        INSERT INTO joined_channels
        (user_id, channel_name, join_date)
        VALUES (${userId}, ${channelName}, CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
        RETURNING *`
    } else {
      // Users joining a new channel get full permissions
      query = sql`
        INSERT INTO joined_channels
        (user_id, channel_name, join_date, kick, ban, change_topic, toggle_private,
          edit_permissions)
        VALUES (${userId}, ${channelName}, CURRENT_TIMESTAMP AT TIME ZONE 'UTC', true, true, true,
          true, true)
        RETURNING *`
    }

    const result = await client.query<DbJoinedChannel>(
      sql`
        WITH ins AS (`.append(query).append(sql`)
        SELECT ins.*, u.name AS user_name
        FROM ins INNER JOIN users as u ON ins.user_id = u.id;
      `),
    )

    if (result.rowCount < 1) {
      throw new Error('No rows returned')
    }

    return convertJoinedChannelFromDb(result.rows[0])
  }

  if (client) {
    return doIt(client)
  } else {
    return transact(doIt)
  }
}

export interface BaseMessageData {
  readonly type: ServerChatMessageType
}

export interface TextMessageData extends BaseMessageData {
  type: typeof ServerChatMessageType.TextMessage
  text: string
  mentions: SbUserId[]
}

export interface JoinChannelData extends BaseMessageData {
  type: typeof ServerChatMessageType.JoinChannel
}

export type ChatMessageData = TextMessageData | JoinChannelData

export interface ChatMessage {
  msgId: string
  userId: SbUserId
  userName: string
  channelName: string
  sent: Date
  data: ChatMessageData
}

type DbChatMessage = Dbify<ChatMessage>

export async function addMessageToChannel<T extends ChatMessageData>(
  userId: SbUserId,
  channelName: string,
  messageData: T,
  client?: DbClient,
): Promise<ChatMessage & { data: T }> {
  const doIt = async (client: DbClient) => {
    const result = await client.query<DbChatMessage>(sql`
      WITH ins AS (
        INSERT INTO channel_messages (id, user_id, channel_name, sent, data)
        SELECT uuid_generate_v4(), ${userId}, ${channelName},
          CURRENT_TIMESTAMP AT TIME ZONE 'UTC', ${messageData}
        WHERE EXISTS (
          SELECT 1 FROM joined_channels WHERE user_id = ${userId} AND channel_name = ${channelName}
        )
        RETURNING id, user_id, channel_name, sent, data
      )
      SELECT ins.id AS msg_id, users.id AS user_id, users.name AS user_name, ins.channel_name,
        ins.sent, ins.data
      FROM ins INNER JOIN users ON ins.user_id = users.id;
    `)
    if (result.rows.length < 1) {
      throw new Error('No rows returned')
    }

    const row = result.rows[0]
    return {
      msgId: row.msg_id,
      userId: row.user_id,
      userName: row.user_name,
      channelName: row.channel_name,
      sent: row.sent,
      data: row.data as T,
    }
  }

  if (client) {
    return doIt(client)
  } else {
    const { client, done } = await db()
    try {
      return doIt(client)
    } finally {
      done()
    }
  }
}

export async function getMessagesForChannel(
  channelName: string,
  limit = 50,
  beforeDate?: Date,
): Promise<ChatMessage[]> {
  const { client, done } = await db()

  const query = sql`
      WITH messages AS (
        SELECT m.id AS msg_id, u.id AS user_id, u.name AS user_name, m.channel_name, m.sent, m.data
        FROM channel_messages as m INNER JOIN users as u ON m.user_id = u.id
        WHERE m.channel_name = ${channelName} `

  if (beforeDate !== undefined) {
    query.append(sql`AND m.sent < ${beforeDate}`)
  }

  query.append(sql`
        ORDER BY m.sent DESC
        LIMIT ${limit}
      ) SELECT * FROM messages ORDER BY sent ASC`)

  try {
    const result = await client.query<DbChatMessage>(query)

    return result.rows.map(row => ({
      msgId: row.msg_id,
      userId: row.user_id,
      userName: row.user_name,
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
  newOwner: ChatUser | null
}

export async function leaveChannel(
  userId: SbUserId,
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
      SELECT u.name AS user_name, c.user_id, c.join_date
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
      return { newOwner: { id: result.rows[0].user_id, name: result.rows[0].user_name } }
    }

    // Transfer ownership to the user who has joined the channel earliest
    result = await client.query(sql`
      SELECT u.name AS user_name, c.user_id, c.join_date
      FROM joined_channels as c INNER JOIN users as u ON c.user_id = u.id
      WHERE c.channel_name = ${channelName}
      ORDER BY c.join_date`)

    await client.query(sql`
      UPDATE joined_channels
      SET kick=true, ban=true, change_topic=true, toggle_private=true, edit_permissions=true
      WHERE user_id = ${result.rows[0].user_id} AND channel_name = ${channelName}`)
    return { newOwner: { id: result.rows[0].user_id, name: result.rows[0].user_name } }
  })
}

export async function banUserFromChannel(
  channelName: string,
  moderatorId: SbUserId,
  targetId: SbUserId,
  reason?: string,
): Promise<void> {
  const { client, done } = await db()
  try {
    await client.query(sql`
      INSERT INTO channel_bans (user_id, channel_name, ban_time, banned_by, reason)
      VALUES (${targetId}, ${channelName}, ${new Date()}, ${moderatorId}, ${reason});
    `)
  } finally {
    done()
  }
}

export async function isUserBannedFromChannel(
  channelName: string,
  userId: SbUserId,
): Promise<boolean> {
  const { client, done } = await db()
  try {
    const result = await client.query(sql`
      SELECT 1 FROM channel_bans
      WHERE user_id = ${userId} AND channel_name = ${channelName};
    `)
    return !!result.rows.length
  } finally {
    done()
  }
}

export interface Channel {
  name: string
  private: boolean
  highTraffic: boolean
  topic: string
  password: string
}

type DbChannel = Dbify<Channel>

function convertChannelFromDb(props: DbChannel): Channel {
  return {
    name: props.name,
    private: props.private,
    highTraffic: props.high_traffic,
    topic: props.topic,
    password: props.password,
  }
}

export async function findChannel(channelName: string): Promise<Channel | null> {
  const { client, done } = await db()
  try {
    const result = await client.query<DbChannel>(sql`
      SELECT * FROM channels WHERE name = ${channelName};
    `)
    return result.rowCount < 1 ? null : convertChannelFromDb(result.rows[0])
  } finally {
    done()
  }
}
