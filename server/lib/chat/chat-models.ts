import { MergeExclusive } from 'type-fest'
import { assertUnreachable } from '../../../common/assert-unreachable'
import {
  BasicChannelInfo,
  ChannelPermissions,
  ChannelPreferences,
  DetailedChannelInfo,
  JoinedChannelInfo,
  MAXIMUM_JOINED_CHANNELS,
  MAXIMUM_OWNED_CHANNELS,
  SbChannelId,
  ServerChatMessageType,
} from '../../../common/chat'
import { Patch } from '../../../common/patch'
import { SbUser } from '../../../common/users/sb-user'
import { SbUserId } from '../../../common/users/sb-user-id'
import db, { DbClient } from '../db'
import { escapeSearchString } from '../db/escape-search-string'
import { sql, sqlConcat } from '../db/sql'
import transact from '../db/transaction'
import { Dbify } from '../db/types'
import { getUrl } from '../files'
import { findUsersByIdQuery } from '../users/user-model'

export interface UserChannelEntry {
  userId: SbUserId
  channelId: SbChannelId
  joinDate: Date
  channelPreferences: ChannelPreferences
  channelPermissions: ChannelPermissions
}

type DbUserChannelEntry = Dbify<UserChannelEntry & ChannelPreferences & ChannelPermissions>

function convertUserChannelEntryFromDb(props: DbUserChannelEntry): UserChannelEntry {
  return {
    userId: props.user_id,
    channelId: props.channel_id,
    joinDate: props.join_date,
    channelPreferences: {
      hideBanner: props.hide_banner,
    },
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
  return await findUsersByIdQuery(sql`
    SELECT user_id
    FROM channel_users
    WHERE channel_id = ${channelId}
  `)
}

/**
 * Gets a user channel entry for a particular user in a particular channel.
 */
export async function getUserChannelEntryForUser(
  userId: SbUserId,
  channelId: SbChannelId,
  withClient?: DbClient,
): Promise<UserChannelEntry | null> {
  const { client, done } = await db(withClient)
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

/**
 * Gets user channel entries for a particular user in all of the provided channels.
 */
export async function getUserChannelEntriesForUser(
  userId: SbUserId,
  channelIds: SbChannelId[],
  withClient?: DbClient,
): Promise<UserChannelEntry[]> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbUserChannelEntry>(sql`
      SELECT *
      FROM channel_users
      WHERE user_id = ${userId} AND channel_id = ANY(${channelIds});
    `)
    return result.rows.map(row => convertUserChannelEntryFromDb(row))
  } finally {
    done()
  }
}

/**
 * A type that contains a full and flattened list of channel fields.
 *
 * This is only meant to be used internally on the server side; if you need to send any channel
 * information to the client use the helper methods below.
 */
export type FullChannelInfo = BasicChannelInfo & DetailedChannelInfo & JoinedChannelInfo

/**
 * A type that contains channel fields which can be edited. Note that this doesn't mean the API
 * allows editing all of these fields yet, but at some point in the future it might.
 */
export type EditableChannelFields = Omit<FullChannelInfo, 'id' | 'userCount'>

/** Takes the full channel info and returns only the basic fields. */
export function toBasicChannelInfo(channel: FullChannelInfo): BasicChannelInfo {
  return {
    id: channel.id,
    name: channel.name,
    private: channel.private,
    official: channel.official,
  }
}

/** Takes the full channel info and returns only the detailed fields. */
export function toDetailedChannelInfo(channel: FullChannelInfo): DetailedChannelInfo {
  return {
    id: channel.id,
    description: channel.description,
    bannerPath: channel.bannerPath,
    badgePath: channel.badgePath,
    userCount: channel.userCount,
  }
}

/** Takes the full channel info and returns only the joined fields. */
export function toJoinedChannelInfo(channel: FullChannelInfo): JoinedChannelInfo {
  return {
    id: channel.id,
    ownerId: channel.ownerId,
    topic: channel.topic,
  }
}

type DbChannel = Dbify<FullChannelInfo>

function convertChannelFromDb(props: DbChannel): FullChannelInfo {
  return {
    id: props.id,
    name: props.name,
    private: props.private,
    official: props.official,
    userCount: props.user_count,
    ownerId: props.owner_id,
    topic: props.topic,
    description: props.description,
    bannerPath: props.banner_path ? getUrl(props.banner_path) : undefined,
    badgePath: props.badge_path ? getUrl(props.badge_path) : undefined,
  }
}

/**
 * Attempts to create a new channel. Returns the channel info if it was successfully created, or
 * `undefined` if the user reached the limit of created channels.
 *
 * NOTE: This method doesn't add user to the new channel. Use `addUserToChannel` for that.
 */
export async function createChannel(
  userId: SbUserId,
  channelName: string,
  withClient?: DbClient,
): Promise<FullChannelInfo | undefined> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbChannel>(sql`
      INSERT INTO channels (name, owner_id)
      SELECT ${channelName}, ${userId}
      WHERE (
        SELECT COUNT(*)
        FROM channels
        WHERE owner_id = ${userId}
      ) < ${MAXIMUM_OWNED_CHANNELS}
      RETURNING *;
    `)

    return result.rows.length > 0 ? convertChannelFromDb(result.rows[0]) : undefined
  } finally {
    done()
  }
}

/**
 * Updates the channel with the given list of updates. Throws an error if there are no updates, so
 * make sure to only call this method when you update one of the channel's fields.
 */
export async function updateChannel(
  channelId: SbChannelId,
  updates: Patch<EditableChannelFields>,
  withClient?: DbClient,
): Promise<FullChannelInfo> {
  const updateEntries = Object.entries(updates).filter(([_, value]) => value !== undefined)
  if (!updateEntries.length) {
    throw new Error('No columns updated')
  }

  const { client, done } = await db(withClient)
  try {
    const query = sql`
      UPDATE channels
      SET
      ${sqlConcat(
        ', ',
        updateEntries.map(([_key, value]) => {
          const key = _key as keyof typeof updates

          switch (key) {
            case 'name':
              return sql`name = ${value}`
            case 'private':
              return sql`private = ${value}`
            case 'official':
              return sql`official = ${value}`
            case 'description':
              return sql`description = ${value}`
            case 'bannerPath':
              return sql`banner_path = ${value}`
            case 'badgePath':
              return sql`badge_path = ${value}`
            case 'ownerId':
              return sql`owner_id = ${value}`
            case 'topic':
              return sql`topic = ${value}`

            default:
              return assertUnreachable(key)
          }
        }),
      )}
      WHERE id = ${channelId}
      RETURNING *
    `

    const result = await client.query<DbChannel>(query)
    return convertChannelFromDb(result.rows[0])
  } finally {
    done()
  }
}

/**
 * Attempts to add a user to a channel. Returns user channel entry if it was successfully added, or
 * `undefined` if the user reached the limit of joined channels.
 */
export async function addUserToChannel(
  userId: SbUserId,
  channelId: SbChannelId,
  withClient?: DbClient,
): Promise<UserChannelEntry | undefined> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbUserChannelEntry>(sql`
      INSERT INTO channel_users (user_id, channel_id, join_date)
      SELECT ${userId}, ${channelId}, CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
      WHERE (
        SELECT COUNT(*)
        FROM channel_users cu
        INNER JOIN channels c ON cu.channel_id = c.id
        WHERE cu.user_id = ${userId} AND c.official = false
      ) < ${MAXIMUM_JOINED_CHANNELS}
      RETURNING *;
    `)

    return result.rows.length > 0 ? convertUserChannelEntryFromDb(result.rows[0]) : undefined
  } finally {
    done()
  }
}

export interface BaseMessageData {
  readonly type: ServerChatMessageType
}

export interface TextMessageData extends BaseMessageData {
  type: typeof ServerChatMessageType.TextMessage
  /**
   * A processed contents of the text message, where all user and channel mentions are replaced
   * with a custom piece of markup.
   */
  text: string
  /**
   * An array of user IDs that were mentioned in the text message. Will be `undefined` if there were
   * no users mentioned in this message.
   */
  mentions?: SbUserId[]
  /**
   * An array of channel IDs that were mentioned in the text message. Will be `undefined` if there
   * were no channels mentioned in this message.
   */
  channelMentions?: SbChannelId[]
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
        INSERT INTO channel_messages (user_id, channel_id, sent, data)
        SELECT ${userId}, ${channelId},
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

  let query = sql`
      WITH messages AS (
        SELECT m.id AS msg_id, u.id AS user_id, u.name AS user_name, m.channel_id, m.sent, m.data
        FROM channel_messages as m INNER JOIN users as u ON m.user_id = u.id
        WHERE m.channel_id = ${channelId} `

  if (beforeDate !== undefined) {
    query = query.append(sql`AND m.sent < ${beforeDate}`)
  }

  query = query.append(sql`
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

export async function deleteChannelMessage(
  messageId: string,
  channelId: SbChannelId,
  withClient?: DbClient,
): Promise<void> {
  const { client, done } = await db(withClient)
  try {
    await client.query(sql`
      DELETE FROM channel_messages
      WHERE id = ${messageId} AND channel_id = ${channelId};
    `)
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
    if (deleteChannelResult.rowCount) {
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

export async function updateUserPreferences(
  channelId: SbChannelId,
  userId: SbUserId,
  updates: Patch<ChannelPreferences>,
  withClient?: DbClient,
) {
  const updateEntries = Object.entries(updates).filter(([_, value]) => value !== undefined)
  if (!updateEntries.length) {
    throw new Error('No columns updated')
  }

  const { client, done } = await db(withClient)
  try {
    const query = sql`
      UPDATE channel_users
      SET
      ${sqlConcat(
        ', ',
        updateEntries.map(([_key, value]) => {
          const key = _key as keyof typeof updates

          switch (key) {
            case 'hideBanner':
              return sql`hide_banner = ${value}`

            default:
              return assertUnreachable(key)
          }
        }),
      )}
      WHERE channel_id = ${channelId} AND user_id = ${userId}
      RETURNING *
    `

    const result = await client.query<DbUserChannelEntry>(query)
    return convertUserChannelEntryFromDb(result.rows[0])
  } finally {
    done()
  }
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
    let query = sql`
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
      query = query.append(sql`
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
    let query = sql`
      INSERT INTO channel_identifier_bans (
        channel_id, identifier_type, identifier_hash, time_banned, first_user_id
      )
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
      query = query.append(sql`
        AND identifier_type != 0
      `)
    }

    query = query.append(sql`
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

/** Returns a chat channel with the matching ID if it exists. */
export async function getChannelInfo(
  channelId: SbChannelId,
  withClient?: DbClient,
): Promise<FullChannelInfo | undefined> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbChannel>(sql`
      SELECT *
      FROM channels
      WHERE id = ${channelId};
    `)

    return result.rows.length ? convertChannelFromDb(result.rows[0]) : undefined
  } finally {
    done()
  }
}

/**
 * Returns the data for all channels with the specified IDs. If a channel cannot be found it will
 * not be included in the result. The order of the result is not guaranteed.
 */
export async function getChannelInfos(
  channelIds: SbChannelId[],
  withClient?: DbClient,
): Promise<FullChannelInfo[]> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbChannel>(sql`
      SELECT *
      FROM channels
      WHERE id = ANY(${channelIds});
    `)

    return result.rows.map(row => convertChannelFromDb(row))
  } finally {
    done()
  }
}

/** Returns a chat channel with the matching name if it exists. */
export async function findChannelByName(
  channelName: string,
  withClient?: DbClient,
): Promise<FullChannelInfo | undefined> {
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

/**
 * Returns the data for all channels with the specified names. If a channel cannot be found it will
 * not be included in the result. The order of the result is not guaranteed.
 */
export async function findChannelsByName(
  names: string[],
  withClient?: DbClient,
): Promise<FullChannelInfo[]> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbChannel>(sql`
      SELECT *
      FROM channels
      WHERE name = ANY (${names});
    `)

    return result.rows.map(row => convertChannelFromDb(row))
  } finally {
    done()
  }
}

/**
 * Returns a list of chat channels, optionally filtered by a `searchStr`.
 */
export async function searchChannels(
  {
    limit,
    offset,
    searchStr,
  }: {
    limit: number
    offset: number
    searchStr?: string
  },
  withClient?: DbClient,
): Promise<FullChannelInfo[]> {
  const { client, done } = await db(withClient)
  try {
    let query = sql`
      SELECT *
      FROM channels
    `

    if (searchStr) {
      query = query.append(sql`WHERE name ILIKE ${`%${escapeSearchString(searchStr)}%`}`)
    }

    query = query.append(sql`
      ORDER BY user_count DESC, name
      LIMIT ${limit}
      OFFSET ${offset}
    `)

    const result = await client.query<DbChannel & { joined: boolean }>(query)

    return result.rows.map(row => convertChannelFromDb(row))
  } finally {
    done()
  }
}
