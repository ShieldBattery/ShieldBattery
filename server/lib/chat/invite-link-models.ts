import { SbChannelId } from '../../../common/chat'
import { SbUserId } from '../../../common/users/sb-user-id'
import db, { DbClient } from '../db'
import { sql } from '../db/sql'
import { Dbify } from '../db/types'

/** An invite link into a private channel, as stored. Its `id` is the link's token. */
export interface InviteLinkRecord {
  id: string
  channelId: SbChannelId
  createdBy: SbUserId
  createdAt: Date
  /** When the link stops working, or `undefined` if it never expires. */
  expiresAt?: Date
  /** How many joins the link allows in total, or `undefined` if it's unlimited. */
  maxUses?: number
  uses: number
}

type DbInviteLink = Dbify<InviteLinkRecord>

function convertInviteLinkFromDb(row: DbInviteLink): InviteLinkRecord {
  return {
    id: row.id,
    channelId: row.channel_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? undefined,
    maxUses: row.max_uses ?? undefined,
    uses: row.uses,
  }
}

/**
 * Returns the newest link `createdBy` made for a channel that still has uses left and stays
 * unexpired past `usableUntil`, if there is one.
 */
export async function findReusableInviteLink(
  {
    channelId,
    createdBy,
    usableUntil,
  }: {
    channelId: SbChannelId
    createdBy: SbUserId
    usableUntil: Date
  },
  withClient?: DbClient,
): Promise<InviteLinkRecord | undefined> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbInviteLink>(sql`
      SELECT *
      FROM channel_invite_links
      WHERE channel_id = ${channelId}
        AND created_by = ${createdBy}
        AND (expires_at IS NULL OR expires_at > ${usableUntil})
        AND (max_uses IS NULL OR uses < max_uses)
      ORDER BY created_at DESC
      LIMIT 1;
    `)
    return result.rows.length ? convertInviteLinkFromDb(result.rows[0]) : undefined
  } finally {
    done()
  }
}

/**
 * Creates an invite link into a channel, but only while the channel is private and, unless
 * `asServerModerator` is set, only while `createdBy` is a member of it who may create links (its
 * owner, or any member if the channel lets members invite). Returns `undefined` if that doesn't
 * hold.
 *
 * The channel and membership rows are share-locked while the link is inserted, so a concurrent
 * change of the channel to public or to owner-only invites, or the creator leaving it, either waits
 * for this insert (and then deletes the new link along with the others) or wins, in which case
 * nothing is inserted.
 */
export async function createInviteLink(
  {
    channelId,
    createdBy,
    createdAt,
    expiresAt,
    maxUses,
    asServerModerator,
  }: {
    channelId: SbChannelId
    createdBy: SbUserId
    createdAt: Date
    expiresAt: Date | undefined
    maxUses: number | undefined
    asServerModerator: boolean
  },
  withClient?: DbClient,
): Promise<InviteLinkRecord | undefined> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbInviteLink>(sql`
      WITH private_channel AS (
        SELECT id, owner_id, members_can_invite
        FROM channels
        WHERE id = ${channelId} AND private
        FOR SHARE
      ), membership AS (
        SELECT user_id
        FROM channel_users
        WHERE channel_id = ${channelId} AND user_id = ${createdBy}
        FOR SHARE
      )
      INSERT INTO channel_invite_links (channel_id, created_by, created_at, expires_at, max_uses)
      SELECT private_channel.id, ${createdBy}, ${createdAt}, ${expiresAt ?? null},
        ${maxUses ?? null}
      FROM private_channel
      WHERE ${asServerModerator} OR (
        EXISTS (SELECT 1 FROM membership) AND
        (private_channel.members_can_invite OR private_channel.owner_id = ${createdBy})
      )
      RETURNING *;
    `)
    return result.rows.length ? convertInviteLinkFromDb(result.rows[0]) : undefined
  } finally {
    done()
  }
}

/**
 * Returns the invite link with the given id, if it exists. With `forUpdate`, the link's row stays
 * locked until the transaction `withClient` belongs to ends, so its use count can be checked and
 * changed without a concurrent join slipping in between.
 */
export async function getInviteLink(
  id: string,
  { forUpdate = false }: { forUpdate?: boolean } = {},
  withClient?: DbClient,
): Promise<InviteLinkRecord | undefined> {
  const { client, done } = await db(withClient)
  try {
    let query = sql`
      SELECT *
      FROM channel_invite_links
      WHERE id = ${id}
    `
    if (forUpdate) {
      query = query.append(sql` FOR UPDATE`)
    }

    const result = await client.query<DbInviteLink>(query)
    return result.rows.length ? convertInviteLinkFromDb(result.rows[0]) : undefined
  } finally {
    done()
  }
}

/** Records one more join through the invite link with the given id. */
export async function incrementInviteLinkUses(id: string, withClient?: DbClient): Promise<void> {
  const { client, done } = await db(withClient)
  try {
    await client.query(sql`
      UPDATE channel_invite_links
      SET uses = uses + 1
      WHERE id = ${id};
    `)
  } finally {
    done()
  }
}

/** Deletes every invite link a user created for a particular channel. */
export async function deleteInviteLinksCreatedBy(
  { channelId, userId }: { channelId: SbChannelId; userId: SbUserId },
  withClient?: DbClient,
): Promise<void> {
  const { client, done } = await db(withClient)
  try {
    await client.query(sql`
      DELETE FROM channel_invite_links
      WHERE channel_id = ${channelId} AND created_by = ${userId};
    `)
  } finally {
    done()
  }
}

/** Deletes every invite link into a particular channel. */
export async function deleteInviteLinksForChannel(
  channelId: SbChannelId,
  withClient?: DbClient,
): Promise<void> {
  const { client, done } = await db(withClient)
  try {
    await client.query(sql`
      DELETE FROM channel_invite_links
      WHERE channel_id = ${channelId};
    `)
  } finally {
    done()
  }
}

/**
 * Deletes every invite link into a channel except the ones its owner and server moderators created,
 * which stay valid when the channel stops letting other members invite.
 */
export async function deleteMemberInviteLinks(
  { channelId, ownerId }: { channelId: SbChannelId; ownerId: SbUserId | undefined },
  withClient?: DbClient,
): Promise<void> {
  const { client, done } = await db(withClient)
  try {
    await client.query(sql`
      DELETE FROM channel_invite_links l
      WHERE l.channel_id = ${channelId}
        AND l.created_by IS DISTINCT FROM ${ownerId ?? null}
        AND NOT EXISTS (
          SELECT 1
          FROM permissions p
          WHERE p.user_id = l.created_by AND p.moderate_chat_channels
        );
    `)
  } finally {
    done()
  }
}
