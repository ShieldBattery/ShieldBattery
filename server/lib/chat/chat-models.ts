import sql from 'sql-template-strings'
import {
  ChannelInfo,
  ChannelPermissions,
  JoinedChannelData,
  SbChannelId,
  ServerChatMessageType,
} from '../../../common/chat'
import { SbUser, SbUserId } from '../../../common/users/sb-user'
import db, { DbClient } from '../db'
import transact from '../db/transaction'
import { Dbify } from '../db/types'

export interface UserChannelEntry {
  userId: SbUserId
  channelId: SbChannelId
  joinDate: Date
  channelPermissions: ChannelPermissions
}

type DbUserChannelEntry = Dbify<UserChannelEntry & ChannelPermissions>

function convertUserChannelEntryFromDb(props: DbUserChannelEntry): UserChannelEntry {
  return {
    userId: props.user_id,
    channelId: props.channel_id,
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

/**
 * Gets a user channel entry for each channel that a particular user is in, ordered by their channel
 * join date.
 */
export async function getChannelsForUser(userId: SbUserId): Promise<UserChannelEntry[]> {
  const { client, done } = await db()
  try {
    const result = await client.query<DbUserChannelEntry>(sql`
      SELECT *
      FROM channel_users
      WHERE user_id = ${userId}
      ORDER BY join_date;
    `)
    return result.rows.map(row => convertUserChannelEntryFromDb(row))
  } finally {
    done()
  }
}

/**
 * Gets a user info for each user in a particular channel. We don't order the users here since
 * they're re-sorted alphabetically on the client anyway.
 */
export async function getUsersForChannel(channelId: SbChannelId): Promise<SbUser[]> {
  const { client, done } = await db()
  try {
    const result = await client.query<Dbify<SbUser>>(sql`
      SELECT u.id, u.name
      FROM channel_users as c INNER JOIN users as u ON c.user_id = u.id
      WHERE c.channel_id = ${channelId};
    `)
    return result.rows
  } finally {
    done()
  }
}

/**
 * Gets a user channel entry for a particular user in a particular channel.
 */
export async function getUserChannelEntryForUser(
  userId: SbUserId,
  channelId: SbChannelId,
): Promise<UserChannelEntry | null> {
  const { client, done } = await db()
  try {
    const result = await client.query<DbUserChannelEntry>(sql`
      SELECT *
      FROM channel_users
      WHERE channel_id = ${channelId} AND user_id = ${userId};
    `)
    return result.rowCount < 1 ? null : convertUserChannelEntryFromDb(result.rows[0])
  } finally {
    done()
  }
}

type DbChannel = Dbify<ChannelInfo & JoinedChannelData>

function convertChannelFromDb(props: DbChannel): ChannelInfo {
  return {
    id: props.id,
    name: props.name,
    private: props.private,
    highTraffic: props.high_traffic,
    joinedChannelData: {
      ownerId: props.owner_id,
      topic: props.topic,
      password: props.password,
    },
  }
}

export async function createChannel(
  userId: SbUserId,
  channelName: string,
  withClient?: DbClient,
): Promise<ChannelInfo> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbChannel>(sql`
      INSERT INTO channels (name, owner_id)
      VALUES (${channelName}, ${userId})
      RETURNING *;
    `)

    return convertChannelFromDb(result.rows[0])
  } finally {
    done()
  }
}

export async function addUserToChannel(
  userId: SbUserId,
  channelId: SbChannelId,
  withClient?: DbClient,
): Promise<UserChannelEntry> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbUserChannelEntry>(sql`
      INSERT INTO channel_users (user_id, channel_id, join_date)
      VALUES (${userId}, ${channelId}, CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
      RETURNING *;
    `)

    if (result.rowCount < 1) {
      throw new Error('No rows returned')
    }

    return convertUserChannelEntryFromDb(result.rows[0])
  } finally {
    done()
  }
}

export interface BaseMessageData {
  readonly type: ServerChatMessageType
}

export interface TextMessageData extends BaseMessageData {
  type: typeof ServerChatMessageType.TextMessage
  text: string
  mentions?: SbUserId[]
}

export interface JoinChannelData extends BaseMessageData {
  type: typeof ServerChatMessageType.JoinChannel
}

export type ChatMessageData = TextMessageData | JoinChannelData

export interface ChatMessage {
  msgId: string
  userId: SbUserId
  userName: string
  channelId: SbChannelId
  sent: Date
  data: ChatMessageData
}

type DbChatMessage = Dbify<ChatMessage>

export async function addMessageToChannel<T extends ChatMessageData>(
  userId: SbUserId,
  channelId: SbChannelId,
  messageData: T,
  client?: DbClient,
): Promise<ChatMessage & { data: T }> {
  const doIt = async (client: DbClient) => {
    const result = await client.query<DbChatMessage>(sql`
      WITH ins AS (
        INSERT INTO channel_messages (id, user_id, channel_id, sent, data)
        SELECT uuid_generate_v4(), ${userId}, ${channelId},
          CURRENT_TIMESTAMP AT TIME ZONE 'UTC', ${messageData}
        WHERE EXISTS (
          SELECT 1 FROM channel_users WHERE user_id = ${userId} AND channel_id = ${channelId}
        )
        RETURNING id, user_id, channel_id, sent, data
      )
      SELECT ins.id AS msg_id, users.id AS user_id, users.name AS user_name, ins.channel_id,
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
      channelId: row.channel_id,
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
  channelId: SbChannelId,
  limit = 50,
  beforeDate?: Date,
): Promise<ChatMessage[]> {
  const { client, done } = await db()

  const query = sql`
      WITH messages AS (
        SELECT m.id AS msg_id, u.id AS user_id, u.name AS user_name, m.channel_id, m.sent, m.data
        FROM channel_messages as m INNER JOIN users as u ON m.user_id = u.id
        WHERE m.channel_id = ${channelId} `

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
      channelId: row.channel_id,
      sent: row.sent,
      data: row.data,
    }))
  } finally {
    done()
  }
}

export interface LeaveChannelResult {
  /**
   * The ID of a user that was selected as a new owner of the channel, or `undefined` if the channel
   * ownership has been left unchanged.
   */
  newOwnerId?: SbUserId
}

export async function removeUserFromChannel(
  userId: SbUserId,
  channelId: SbChannelId,
): Promise<LeaveChannelResult> {
  return transact(async function (client) {
    await client.query(sql`
      DELETE FROM channel_users
      WHERE user_id = ${userId} AND channel_id = ${channelId};
    `)

    const deleteChannelResult = await client.query(sql`
      DELETE FROM channels
      WHERE id = ${channelId} AND
        NOT EXISTS (SELECT 1 FROM channel_users WHERE channel_id = ${channelId})
      RETURNING id;
    `)
    if (deleteChannelResult.rowCount > 0) {
      // Channel was deleted; meaning there is no one left in it so there is no one to transfer the
      // ownership to
      return {}
    }

    const currentOwnerResult = await client.query<{ owner_id: SbUserId }>(sql`
      SELECT owner_id
      FROM channels
      WHERE id = ${channelId};
    `)

    if (currentOwnerResult.rows[0].owner_id !== userId) {
      // The leaving user was not the owner, so there's no reason to transfer ownership to anyone
      return {}
    }

    const highTrafficChannelResult = await client.query(sql`
      SELECT id FROM channels
      WHERE id = ${channelId} AND high_traffic = true;
    `)
    if (highTrafficChannelResult.rowCount > 0) {
      // Don't transfer ownership in "high traffic" channels
      return {}
    }

    const earliestPermissionUserResult = await client.query<DbUserChannelEntry>(sql`
      SELECT *
      FROM channel_users
      WHERE channel_id = ${channelId} AND (kick = true OR ban = true OR
        change_topic = true OR toggle_private = true OR edit_permissions = true)
      ORDER BY join_date;
    `)
    if (earliestPermissionUserResult.rowCount > 0) {
      // Transfer ownership to the user who has joined the channel earliest and has an
      // `edit_permissions` permission, or if there's no such user, then choose the first user with
      // any kind of permission
      const newOwner =
        earliestPermissionUserResult.rows.find(u => u.edit_permissions) ||
        earliestPermissionUserResult.rows[0]

      await client.query(sql`
        UPDATE channels
        SET owner_id = ${newOwner.user_id}
        WHERE id = ${channelId};
      `)
      return { newOwnerId: newOwner.user_id }
    }

    // Transfer ownership to the user who has joined the channel earliest
    const earliestUserResult = await client.query<{ user_id: SbUserId }>(sql`
      SELECT user_id
      FROM channel_users
      WHERE channel_id = ${channelId}
      ORDER BY join_date;
    `)

    // This would mean that the channel has no users left at all which would be very odd indeed
    if (earliestUserResult.rowCount < 1) {
      throw new Error('No rows returned')
    }

    await client.query(sql`
      UPDATE channels
      SET owner_id = ${earliestUserResult.rows[0].user_id}
      WHERE id = ${channelId};
    `)
    return { newOwnerId: earliestUserResult.rows[0].user_id }
  })
}

export async function updateUserPermissions(
  channelId: SbChannelId,
  userId: SbUserId,
  perms: ChannelPermissions,
  withClient?: DbClient,
) {
  const { client, done } = await db(withClient)
  try {
    await client.query(sql`
      UPDATE channel_users
      SET
        kick = ${perms.kick},
        ban = ${perms.ban},
        change_topic = ${perms.changeTopic},
        toggle_private = ${perms.togglePrivate},
        edit_permissions = ${perms.editPermissions}
      WHERE channel_id = ${channelId} AND user_id = ${userId};
    `)
  } finally {
    done()
  }
}

export async function banUserFromChannel(
  channelId: SbChannelId,
  moderatorId: SbUserId,
  targetId: SbUserId,
  reason?: string,
): Promise<void> {
  const { client, done } = await db()
  try {
    await client.query(sql`
      INSERT INTO channel_bans (user_id, channel_id, ban_time, banned_by, reason)
      VALUES (${targetId}, ${channelId}, ${new Date()}, ${moderatorId}, ${reason});
    `)
  } finally {
    done()
  }
}

export async function isUserBannedFromChannel(
  channelId: SbChannelId,
  userId: SbUserId,
  client?: DbClient,
): Promise<boolean> {
  const { client: dbClient, done } = client ? { client, done: () => {} } : await db()
  try {
    const result = await dbClient.query(sql`
      SELECT 1 FROM channel_bans
      WHERE user_id = ${userId} AND channel_id = ${channelId};
    `)
    return !!result.rows.length
  } finally {
    done()
  }
}

/**
 * Retrieves information for the specified chat channels. The channels are returned in the same
 * order they were passed in. If one of the channels could not be found, it will not be included in
 * the result.
 */
export async function getChannelInfo(
  channelIds: SbChannelId[],
  withClient?: DbClient,
): Promise<ChannelInfo[]> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbChannel>(sql`
      SELECT *
      FROM channels
      WHERE id = ANY(${channelIds});
    `)

    if (result.rowCount < 1) {
      return []
    }

    const channelInfos = await Promise.all(result.rows.map(c => convertChannelFromDb(c)))
    const idToChannelInfo = new Map<SbChannelId, ChannelInfo>()
    for (const channelInfo of channelInfos) {
      idToChannelInfo.set(channelInfo.id, channelInfo)
    }

    const orderedChannelInfos = []
    for (const id of channelIds) {
      const info = idToChannelInfo.get(id)
      if (info) {
        orderedChannelInfos.push(info)
      }
    }

    return orderedChannelInfos
  } finally {
    done()
  }
}

export async function findChannelByName(
  channelName: string,
  withClient?: DbClient,
): Promise<ChannelInfo | undefined> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbChannel>(sql`
      SELECT *
      FROM channels
      WHERE name = ${channelName};
    `)

    return result.rows.length > 0 ? convertChannelFromDb(result.rows[0]) : undefined
  } finally {
    done()
  }
}
