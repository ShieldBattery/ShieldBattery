import sql from 'sql-template-strings'
import { MergeExclusive } from 'type-fest'
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
    return result.rows.length < 1 ? null : convertUserChannelEntryFromDb(result.rows[0])
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
    official: props.official,
    joinedChannelData: {
      ownerId: props.owner_id,
      topic: props.topic,
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

    if (result.rows.length < 1) {
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

    // NOTE(2Pac): Only non-official channels are deleted when everyone leaves
    const deleteChannelResult = await client.query(sql`
      DELETE FROM channels
      WHERE id = ${channelId} AND official = false AND
        NOT EXISTS (SELECT 1 FROM channel_users WHERE channel_id = ${channelId});
    `)
    if (deleteChannelResult.rowCount > 0) {
      // Channel was deleted; meaning there is no one left in it so there is no one to transfer the
      // ownership to
      return {}
    }

    const channelResult = await client.query<DbChannel>(sql`
      SELECT *
      FROM channels
      WHERE id = ${channelId};
    `)
    if (channelResult.rows[0].owner_id !== userId) {
      // The leaving user was not the owner, so there's no reason to transfer ownership to anyone
      return {}
    } else if (channelResult.rows[0].official) {
      // Don't transfer ownership in "official" channels
      return {}
    }

    // Transfer ownership to the user who has joined the channel earliest and has any of the
    // permissions in the following order:
    //   - `edit_permissions`
    //   - `ban`
    //   - `kick`
    //   - `toggle_private`
    //   - `change_topic`
    // If there's no such user, then the user who has joined the channel earliest is chosen.
    const newOwnerResult = await client.query<{ owner_id: SbUserId }>(sql`
      WITH own AS (
        SELECT user_id
        FROM channel_users
        WHERE channel_id = ${channelId}
        ORDER BY
          edit_permissions DESC,
          ban DESC,
          kick DESC,
          toggle_private DESC,
          change_topic DESC,
          join_date
        LIMIT 1
      )
      UPDATE channels
      SET owner_id = own.user_id
      FROM own
      WHERE id = ${channelId}
      RETURNING owner_id;
    `)
    if (newOwnerResult.rows.length < 1) {
      // This would mean that the channel has no users left at all which would be very odd indeed
      throw new Error('No rows returned')
    }

    return { newOwnerId: newOwnerResult.rows[0].owner_id }
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

export async function countBannedIdentifiersForChannel(
  {
    channelId,
    targetId,
    filterBrowserprint = true,
  }: {
    channelId: SbChannelId
    targetId: SbUserId
    filterBrowserprint?: boolean
  },
  withClient?: DbClient,
): Promise<number> {
  const { client, done } = await db(withClient)

  try {
    const query = sql`
      SELECT COUNT(DISTINCT identifier_type) as "matches"
      FROM channel_identifier_bans cib
      WHERE cib.channel_id = ${channelId}
      AND (cib.identifier_type, cib.identifier_hash) IN (
        SELECT identifier_type, identifier_hash
        FROM user_identifiers ui
        WHERE ui.user_id = ${targetId}
      )
    `

    if (filterBrowserprint) {
      query.append(sql`
        AND cib.identifier_type != 0
      `)
    }

    const result = await client.query<{ matches: string }>(query)
    return result.rows.length > 0 ? Number(result.rows[0].matches) : 0
  } finally {
    done()
  }
}

export async function banUserFromChannel(
  {
    channelId,
    moderatorId,
    targetId,
    reason,
    automated = false,
    connectedUsers = [],
  }: MergeExclusive<
    {
      channelId: SbChannelId
      moderatorId?: SbUserId
      targetId: SbUserId
      reason?: string
    },
    {
      channelId: SbChannelId
      moderatorId?: SbUserId
      targetId: SbUserId
      automated: boolean
      connectedUsers: SbUserId[]
    }
  >,
  withClient?: DbClient,
): Promise<void> {
  const { client, done } = await db(withClient)
  try {
    if (automated && connectedUsers.length > 0) {
      await client.query(sql`
        WITH rc AS (
          SELECT reason, MIN(ban_time) AS date, COUNT(*) AS reason_count
          FROM channel_bans
          WHERE channel_id = ${channelId} AND user_id = ANY(${connectedUsers})
          GROUP BY reason
          ORDER BY reason_count DESC, date DESC
          LIMIT 1
        )
        INSERT INTO channel_bans (user_id, channel_id, ban_time, banned_by, reason, automated)
        SELECT ${targetId}, ${channelId}, ${new Date()}, ${moderatorId}, rc.reason, ${automated}
        FROM rc;
      `)
    } else {
      await client.query(sql`
        INSERT INTO channel_bans (user_id, channel_id, ban_time, banned_by, reason, automated)
        VALUES (${targetId}, ${channelId}, ${new Date()}, ${moderatorId}, ${reason}, ${automated});
      `)
    }
  } finally {
    done()
  }
}

export async function banAllIdentifiersFromChannel(
  {
    channelId,
    targetId,
    timeBanned = new Date(),
    filterBrowserprint = true,
  }: {
    channelId: SbChannelId
    targetId: SbUserId
    timeBanned?: Date
    filterBrowserprint?: boolean
  },
  withClient?: DbClient,
): Promise<void> {
  const { client, done } = await db(withClient)

  try {
    const query = sql`
      INSERT INTO channel_identifier_bans
      SELECT
        ${channelId} AS "channel_id",
        identifier_type,
        identifier_hash,
        ${timeBanned} AS "time_banned",
        user_id
      FROM user_identifiers
      WHERE user_id = ${targetId}
    `

    if (filterBrowserprint) {
      query.append(sql`
        AND identifier_type != 0
      `)
    }

    query.append(sql`
      ON CONFLICT (channel_id, identifier_type, identifier_hash)
      DO NOTHING
    `)

    await client.query(query)
  } finally {
    done()
  }
}

export async function isUserBannedFromChannel(
  channelId: SbChannelId,
  userId: SbUserId,
  withClient?: DbClient,
): Promise<boolean> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query(sql`
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

    if (result.rows.length < 1) {
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
