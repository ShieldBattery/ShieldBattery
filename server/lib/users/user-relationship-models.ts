import sql from 'sql-template-strings'
import { assertUnreachable } from '../../../common/assert-unreachable'
import {
  UserRelationship,
  UserRelationshipKind,
  UserRelationshipSummary,
} from '../../../common/users/relationships'
import { SbUserId } from '../../../common/users/sb-user'
import db, { DbClient } from '../db'
import transact from '../db/transaction'
import { Dbify } from '../db/types'

// NOTE(tec27): Relationships in the database are stored in a way where every relationship between
// 2 users can be represented by 1 row. This allows us to better ensure data integrity around
// friend request <-> friendship <-> block transitions.
//
// - Friendship is always mutual. One user removing a side of the friendship will clear the
// relationship row.
//
// - Friend requests are one-way, a user must accept the request to start a friendship (or send a
// similarly timed request of their own).
//
// - Blocks prevent friend request and override existing friendships/requests.
//
// These are all implementation details of the storage in the DB, and are not exposed to callers of
// the external API here. Instead, those focus on particular actions (requesting/accepting requests,
// removing friendship, blocking, etc.).

enum MutualKind {
  /**
   * Represents a mutual friend relationship between 2 users.
   */
  Friend = 'friend',
  /**
   * Represents that the user with a lower ID has requested to create a `Friend` relationship with
   * another user with a higher ID.
   */
  FriendRequestLowToHigh = 'friend_request_low_to_high',
  /**
   * Represents that the user with a higher ID has requested to create a `Friend` relationship with
   * another user with a lower ID.
   */
  FriendRequestHighToLow = 'friend_request_high_to_low',
  /**
   * Represents that the user with a lower ID has blocked a user with a higher ID.
   */
  BlockLowToHigh = 'block_low_to_high',
  /**
   * Represents that the user with a higher ID has blocked a user with a lower ID.
   */
  BlockHighToLow = 'block_high_to_low',
  /**
   * Represents that 2 users have mutually blocked each other.
   */
  BlockBoth = 'block_both',
}

interface MutualUserRelationship {
  userLow: SbUserId
  userHigh: SbUserId
  kind: MutualKind
  lowCreatedAt?: Date
  highCreatedAt?: Date
}

type DbMutualUserRelationship = Dbify<MutualUserRelationship>

function convertFromDb(dbRelationship: DbMutualUserRelationship): MutualUserRelationship {
  return {
    userLow: dbRelationship.user_low,
    userHigh: dbRelationship.user_high,
    kind: dbRelationship.kind,
    lowCreatedAt: dbRelationship.low_created_at,
    highCreatedAt: dbRelationship.high_created_at,
  }
}

function mutualToExternal(relationship: MutualUserRelationship): UserRelationship[] {
  switch (relationship.kind) {
    case MutualKind.Friend:
      return [
        {
          fromId: relationship.userLow,
          toId: relationship.userHigh,
          kind: UserRelationshipKind.Friend,
          createdAt: relationship.lowCreatedAt!,
        },
        {
          fromId: relationship.userHigh,
          toId: relationship.userLow,
          kind: UserRelationshipKind.Friend,
          createdAt: relationship.highCreatedAt!,
        },
      ]
    case MutualKind.FriendRequestLowToHigh:
      return [
        {
          fromId: relationship.userLow,
          toId: relationship.userHigh,
          kind: UserRelationshipKind.FriendRequest,
          createdAt: relationship.lowCreatedAt!,
        },
      ]
    case MutualKind.FriendRequestHighToLow:
      return [
        {
          fromId: relationship.userHigh,
          toId: relationship.userLow,
          kind: UserRelationshipKind.FriendRequest,
          createdAt: relationship.highCreatedAt!,
        },
      ]
    case MutualKind.BlockLowToHigh:
      return [
        {
          fromId: relationship.userLow,
          toId: relationship.userHigh,
          kind: UserRelationshipKind.Block,
          createdAt: relationship.lowCreatedAt!,
        },
      ]
    case MutualKind.BlockHighToLow:
      return [
        {
          fromId: relationship.userHigh,
          toId: relationship.userLow,
          kind: UserRelationshipKind.Block,
          createdAt: relationship.highCreatedAt!,
        },
      ]
    case MutualKind.BlockBoth:
      return [
        {
          fromId: relationship.userLow,
          toId: relationship.userHigh,
          kind: UserRelationshipKind.Block,
          createdAt: relationship.lowCreatedAt!,
        },
        {
          fromId: relationship.userHigh,
          toId: relationship.userLow,
          kind: UserRelationshipKind.Block,
          createdAt: relationship.highCreatedAt!,
        },
      ]
    default:
      return assertUnreachable(relationship.kind)
  }
}

/**
 * Returns a summary of all the relationships for a specified user, separated into the various
 * relationship types and viewed from the perspective of the user.
 */
export async function getRelationshipSummaryForUser(
  userId: SbUserId,
  withClient?: DbClient,
): Promise<UserRelationshipSummary> {
  const { client, done } = await db(withClient)

  try {
    const result = await client.query<DbMutualUserRelationship>(sql`
      SELECT *
      FROM user_relationships
      WHERE user_low = ${userId}
        AND kind IN ('friend', 'block_both',
          'friend_request_low_to_high', 'friend_request_high_to_low', 'block_low_to_high')
      UNION
      SELECT *
      FROM user_relationships
      WHERE user_high = ${userId}
        AND kind IN ('friend', 'block_both',
          'friend_request_low_to_high', 'friend_request_high_to_low', 'block_high_to_low');
    `)

    const summary: UserRelationshipSummary = {
      friends: [],
      incomingRequests: [],
      outgoingRequests: [],
      blocks: [],
    }
    for (const r of result.rows) {
      const row = convertFromDb(r)
      const userIsLow = row.userLow === userId
      switch (row.kind) {
        case MutualKind.Friend:
          summary.friends.push({
            fromId: userId,
            toId: userIsLow ? row.userHigh : row.userLow,
            kind: UserRelationshipKind.Friend,
            createdAt: userIsLow ? row.lowCreatedAt! : row.highCreatedAt!,
          })
          break

        case MutualKind.FriendRequestLowToHigh:
          if (userIsLow) {
            summary.outgoingRequests.push({
              fromId: userId,
              toId: row.userHigh,
              kind: UserRelationshipKind.FriendRequest,
              createdAt: row.lowCreatedAt!,
            })
          } else {
            summary.incomingRequests.push({
              fromId: row.userLow,
              toId: userId,
              kind: UserRelationshipKind.FriendRequest,
              createdAt: row.lowCreatedAt!,
            })
          }
          break

        case MutualKind.FriendRequestHighToLow:
          if (userIsLow) {
            summary.incomingRequests.push({
              fromId: row.userHigh,
              toId: userId,
              kind: UserRelationshipKind.FriendRequest,
              createdAt: row.highCreatedAt!,
            })
          } else {
            summary.outgoingRequests.push({
              fromId: userId,
              toId: row.userLow,
              kind: UserRelationshipKind.FriendRequest,
              createdAt: row.highCreatedAt!,
            })
          }

        case MutualKind.BlockBoth:
        case MutualKind.BlockLowToHigh:
        case MutualKind.BlockHighToLow:
          summary.blocks.push({
            fromId: userId,
            toId: userIsLow ? row.userHigh : row.userLow,
            kind: UserRelationshipKind.Block,
            createdAt: userIsLow ? row.lowCreatedAt! : row.highCreatedAt!,
          })
          break

        default:
          assertUnreachable(row.kind)
      }
    }

    return summary
  } finally {
    done()
  }
}

/**
 * Returns the number of friends and outgoing friend requests a user has, excluding ones to the
 * specified user. This can be used to check if the user is at their limit of friends before making
 * a new request.
 */
export async function countFriendsAndRequests(
  userId: SbUserId,
  excludeUser: SbUserId,
  withClient?: DbClient,
): Promise<number> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<{ count: string }>(sql`
      SELECT COUNT(*) AS count
      FROM user_relationships
      WHERE
        (
          user_low = ${userId} AND
          user_high != ${excludeUser} AND
          kind IN ('friend', 'friend_request_low_to_high')
        ) OR (
          user_high = ${userId} AND
          user_low != ${excludeUser} AND
          kind IN ('friend', 'friend_request_high_to_low')
        );
    `)

    return Number(result.rows[0].count)
  } finally {
    done()
  }
}

/**
 * Returns the number of outgoing blocks a user has, excluding any against the specified user. This
 * can be used to check if the user is at their limit of blocks before making a new one.
 */
export async function countBlocks(
  userId: SbUserId,
  excludeUser: SbUserId,
  withClient?: DbClient,
): Promise<number> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<{ count: string }>(sql`
      SELECT COUNT(*) AS count
      FROM user_relationships
      WHERE
        (
          user_low = ${userId} AND
          user_high != ${excludeUser} AND
          kind IN ('block_both', 'block_low_to_high')
        ) OR (
          user_high = ${userId} AND
          user_low != ${excludeUser} AND
          kind IN ('block_both', 'block_high_to_low')
        );
    `)

    return Number(result.rows[0].count)
  } finally {
    done()
  }
}

/**
 * Sends a friend request from `fromId` to `toId`, returning the updated `UserRelationship`s
 * (whether or not they've changed as a result of this request).
 */
export async function sendFriendRequest(
  fromId: SbUserId,
  toId: SbUserId,
  date: Date,
  withClient?: DbClient,
): Promise<UserRelationship[]> {
  if (fromId === toId) {
    throw new Error('Cannot send friend request to self')
  }

  const [lowId, highId] = fromId < toId ? [fromId, toId] : [toId, fromId]
  const fromIsLow = fromId === lowId

  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbMutualUserRelationship>(sql`
      INSERT INTO user_relationships AS ur
        (user_low, user_high, kind, low_created_at, high_created_at)
      VALUES (${lowId}, ${highId},
        ${fromIsLow ? MutualKind.FriendRequestLowToHigh : MutualKind.FriendRequestHighToLow},
        ${fromIsLow ? date : undefined}, ${fromIsLow ? undefined : date})
      ON CONFLICT (user_low, user_high) DO UPDATE
      SET
        kind = CASE
          WHEN ur.kind = 'friend' THEN 'friend'
          WHEN ur.kind = 'friend_request_low_to_high' THEN
            ${fromIsLow ? MutualKind.FriendRequestLowToHigh : MutualKind.Friend}
          WHEN ur.kind = 'friend_request_high_to_low' THEN
            ${fromIsLow ? MutualKind.Friend : MutualKind.FriendRequestHighToLow}
          ELSE ur.kind
        END,
        low_created_at = CASE
          WHEN ur.kind = 'friend_request_high_to_low' THEN EXCLUDED.low_created_at
          ELSE ur.low_created_at
        END,
        high_created_at = CASE
          WHEN ur.kind = 'friend_request_low_to_high' THEN EXCLUDED.high_created_at
          ELSE ur.high_created_at
        END
      RETURNING *;
    `)

    return mutualToExternal(convertFromDb(result.rows[0]))
  } finally {
    done()
  }
}

/**
 * Accepts a friend request from `requestingId` for `acceptingId`. If the users are already friends,
 * the function will return the existing relationship. If no friend request is currently
 * outstanding, this function will return an empty array. (Note that in the case that either user
 * has blocked the other, this function will *NOT* return that relationship, it will just return
 * the empty array)
 */
export async function acceptFriendRequest(
  acceptingId: SbUserId,
  requestingId: SbUserId,
  date: Date,
  withClient?: DbClient,
): Promise<UserRelationship[]> {
  if (acceptingId === requestingId) {
    throw new Error('Cannot accept friend request from self')
  }

  const [lowId, highId] =
    acceptingId < requestingId ? [acceptingId, requestingId] : [requestingId, acceptingId]
  const acceptingIsLow = acceptingId === lowId

  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbMutualUserRelationship>(sql`
      UPDATE user_relationships
        SET
          kind = 'friend',
          low_created_at = COALESCE(low_created_at, ${acceptingIsLow ? date : undefined}),
          high_created_at = COALESCE(high_created_at, ${acceptingIsLow ? undefined : date})
      WHERE user_low = ${lowId} AND user_high = ${highId}
      AND kind IN (${
        acceptingIsLow ? MutualKind.FriendRequestHighToLow : MutualKind.FriendRequestLowToHigh
      }, 'friend')
      RETURNING *;
    `)

    if (!result.rows.length) {
      return []
    }

    return mutualToExternal(convertFromDb(result.rows[0]))
  } finally {
    done()
  }
}

/**
 * Removes a friend request from `fromId` to `toId`.
 *
 * @returns Whether a friend request was removed (`false` indicates that no such request existed
 * previously).
 */
export async function removeFriendRequest(
  fromId: SbUserId,
  toId: SbUserId,
  withClient?: DbClient,
): Promise<boolean> {
  if (fromId === toId) {
    throw new Error('Cannot remove friend request from self')
  }

  const [lowId, highId] = fromId < toId ? [fromId, toId] : [toId, fromId]
  const fromIsLow = fromId === lowId

  const { client, done } = await db(withClient)
  try {
    const result = await client.query(sql`
      DELETE FROM user_relationships
      WHERE user_low = ${lowId} AND user_high = ${highId}
        AND kind = ${
          fromIsLow ? MutualKind.FriendRequestLowToHigh : MutualKind.FriendRequestHighToLow
        };
    `)

    return result.rowCount > 0
  } finally {
    done()
  }
}

/**
 * Removes a friend relationship between `removerId` and `targetId`.
 *
 * @returns Whether a friend relationship was removed (`false` indicates that no such relationship
 * existed previously).
 */
export async function removeFriend(
  removerId: SbUserId,
  targetId: SbUserId,
  withClient?: DbClient,
): Promise<boolean> {
  if (removerId === targetId) {
    throw new Error('Cannot remove self as a friend')
  }

  const [lowId, highId] = removerId < targetId ? [removerId, targetId] : [targetId, removerId]

  const { client, done } = await db(withClient)
  try {
    const result = await client.query(sql`
      DELETE FROM user_relationships
      WHERE kind = 'friend'
        AND user_low = ${lowId}
        AND user_high = ${highId};
    `)

    return result.rowCount > 0
  } finally {
    done()
  }
}

/**
 * Blocks `targetId` for `blockerId`, returning the updated `UserRelationship`s (whether or not
 * they've changed as a result of this request).
 */
export async function blockUser(
  blockerId: SbUserId,
  targetId: SbUserId,
  date: Date,
  withClient?: DbClient,
): Promise<UserRelationship[]> {
  if (blockerId === targetId) {
    throw new Error('Cannot block self')
  }

  const [lowId, highId] = blockerId < targetId ? [blockerId, targetId] : [targetId, blockerId]
  const blockerIsLow = blockerId === lowId

  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbMutualUserRelationship>(sql`
      INSERT INTO user_relationships AS ur
        (user_low, user_high, kind, low_created_at, high_created_at)
      VALUES (${lowId}, ${highId},
        ${blockerIsLow ? MutualKind.BlockLowToHigh : MutualKind.BlockHighToLow},
        ${blockerIsLow ? date : undefined}, ${blockerIsLow ? undefined : date})
      ON CONFLICT (user_low, user_high) DO UPDATE
      SET
        kind = CASE
          WHEN ur.kind = 'block_low_to_high' THEN
            ${blockerIsLow ? MutualKind.BlockLowToHigh : MutualKind.BlockBoth}
          WHEN ur.kind = 'block_high_to_low' THEN
            ${blockerIsLow ? MutualKind.BlockBoth : MutualKind.BlockHighToLow}
          WHEN ur.kind = 'block_both' THEN ur.kind
          ELSE EXCLUDED.kind
        END,
        low_created_at = CASE
          WHEN ur.kind = 'block_both' THEN ur.low_created_at
          WHEN ur.kind = 'block_low_to_high' THEN ur.low_created_at
          WHEN ur.kind = 'block_high_to_low' THEN EXCLUDED.low_created_at
          ELSE EXCLUDED.low_created_at
        END,
        high_created_at = CASE
          WHEN ur.kind = 'block_both' THEN ur.high_created_at
          WHEN ur.kind = 'block_low_to_high' THEN EXCLUDED.high_created_at
          WHEN ur.kind = 'block_high_to_low' THEN ur.high_created_at
          ELSE EXCLUDED.high_created_at
        END
      RETURNING *;
    `)

    return mutualToExternal(convertFromDb(result.rows[0]))
  } finally {
    done()
  }
}

export async function unblockUser(
  unblockerId: SbUserId,
  targetId: SbUserId,
): Promise<UserRelationship[]> {
  if (unblockerId === targetId) {
    throw new Error('Cannot unblock self')
  }

  const [lowId, highId] = unblockerId < targetId ? [unblockerId, targetId] : [targetId, unblockerId]
  const unblockerIsLow = unblockerId === lowId

  return await transact(async client => {
    const current = await client.query<DbMutualUserRelationship>(sql`
      SELECT * FROM user_relationships
      WHERE user_low = ${lowId} AND user_high = ${highId}
      FOR UPDATE;
    `)

    if (!current.rows.length) {
      return []
    }

    const row = convertFromDb(current.rows[0])
    if (
      row.kind === MutualKind.Friend ||
      row.kind === MutualKind.FriendRequestLowToHigh ||
      row.kind === MutualKind.FriendRequestHighToLow
    ) {
      return mutualToExternal(row)
    } else if (
      (unblockerIsLow && row.kind === MutualKind.BlockHighToLow) ||
      (!unblockerIsLow && row.kind === MutualKind.BlockLowToHigh)
    ) {
      return mutualToExternal(row)
    }

    if (row.kind !== MutualKind.BlockBoth) {
      // 1-way block, just delete the row
      await client.query(sql`
        DELETE FROM user_relationships
        WHERE user_low = ${lowId} AND user_high = ${highId};
      `)
      return []
    } else {
      // 2-way block, adjust the kind to the remaining direction
      const result = await client.query<DbMutualUserRelationship>(sql`
        UPDATE user_relationships ur
        SET
          kind = ${unblockerIsLow ? MutualKind.BlockHighToLow : MutualKind.BlockLowToHigh},
          low_created_at = ${unblockerIsLow ? undefined : row.lowCreatedAt},
          high_created_at = ${unblockerIsLow ? row.highCreatedAt : undefined},
        WHERE user_low = ${lowId} AND user_high = ${highId}
        RETURNING *;
      `)

      return mutualToExternal(convertFromDb(result.rows[0]))
    }
  })
}

/** Returns the relationship(s) between two users, if any. */
export async function getRelationshipsForUsers(
  userA: SbUserId,
  userB: SbUserId,
  withClient?: DbClient,
): Promise<UserRelationship[]> {
  if (userA === userB) {
    throw new Error('Cannot have a relationship with self')
  }

  const [lowId, highId] = userA < userB ? [userA, userB] : [userB, userA]
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbMutualUserRelationship>(sql`
      SELECT * FROM user_relationships
      WHERE user_low = ${lowId} AND user_high = ${highId};
    `)

    return result.rows.length > 0 ? mutualToExternal(convertFromDb(result.rows[0])) : []
  } finally {
    done()
  }
}
