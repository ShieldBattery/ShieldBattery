import httpErrors from 'http-errors'
import { injectable } from 'tsyringe'
import { SbUserId } from '../../../common/users/sb-user-id'
import { DbClient } from '../db'
import { sql } from '../db/sql'
import transact from '../db/transaction'
import { getGameRecord, lockGameAndCheckReconciled } from '../games/game-models'
import { recordReplayViolation } from '../models/game-replay-violations'
import { getUserGameRecord } from '../models/games-users'
import { Redis } from '../redis/redis'
import { DeletedSessionRegistry } from '../session/deleted-sessions'
import { sessionKey, userSessionsKey } from '../session/jwt-session-middleware'
import { UserSocketsManager } from '../websockets/socket-groups'
import {
  banUsers,
  getActiveUserBan,
  liftUserBans,
  lockActiveBanUsers,
  UserBanRow,
} from './ban-models'
import {
  BanRequest,
  completeBanRequest,
  lockBanRequest,
  recordBanRequestBans,
} from './ban-request-models'
import { MIN_IDENTIFIER_MATCHES } from './client-ids'
import { IDENTIFIER_MODERATION_LOCK } from './identifier-locks'
import {
  banAllIdentifiers,
  countBannedUserIdentifiers,
  findConnectedUsers,
  liftIdentifierBans,
} from './user-identifiers'
import { findUserById } from './user-model'

class IdentifierBanNotNeeded extends Error {}

export type IdentifierBanResult =
  | { status: 'banned'; banId: string }
  | { status: 'alreadyBanned' }
  | { status: 'notNeeded' }

/** Serializes group mutations even when an unban targets a different account in the same group. */
async function lockIdentifierModeration(client: DbClient): Promise<void> {
  await client.query(sql`SELECT pg_advisory_xact_lock(${IDENTIFIER_MODERATION_LOCK}, 0)`)
}

@injectable()
export class BanEnacter {
  constructor(
    private redis: Redis,
    private userSocketsManager: UserSocketsManager,
    private deletedSessions: DeletedSessionRegistry,
  ) {}

  /**
   * Carries out banning a user, doing all the necessary session manipulation + marking to prevent
   * ban evasion.
   */
  async enactBan({
    targetId,
    bannedBy,
    endTime,
    reason,
  }: {
    targetId: SbUserId
    bannedBy?: SbUserId
    endTime: Date
    reason?: string
  }): Promise<UserBanRow> {
    const { users, banEntries } = await transact(async client => {
      await lockIdentifierModeration(client)
      // NOTE(tec27): This does have a potential race condition, where if a user logged in on an
      // account that wasn't previously connected between the time we retrieve this and the time
      // we enact the ban (below), we wouldn't ban them. I don't think this is very likely to
      // happen, though, and they would get banned shortly after anyway (because of the checks
      // on login and matchmaking, etc.).
      const connectedUsers = await findConnectedUsers(targetId, MIN_IDENTIFIER_MATCHES, client)
      const users = connectedUsers.concat(targetId)

      const banEntries = await banUsers(
        {
          users,
          bannedBy,
          endTime,
          reason,
        },
        client,
      )
      await banAllIdentifiers({ users, bannedUntil: endTime }, client)

      return { users, banEntries }
    })

    await this.clearSessions(users)

    for (const banEntry of banEntries) {
      if (banEntry.userId === targetId) {
        return banEntry
      }
    }

    throw new Error(`Failed to find ban entry for user ${targetId} after banning.`)
  }

  /** Creates a durable ban once, retrying interrupted session cleanup without applying new bans. */
  async enactBanRequest(request: BanRequest): Promise<string> {
    const result = await this.applyBanRequest(request, false)
    if (result.status !== 'banned') throw new Error('Missing ban result')
    return result.banId
  }

  /** Checks live identifier bans under the same lock as unbanning, and retains a durable receipt. */
  async enactIdentifierBanRequest(request: BanRequest): Promise<IdentifierBanResult> {
    try {
      return await this.applyBanRequest(request, true)
    } catch (err) {
      if (err instanceof IdentifierBanNotNeeded) return { status: 'notNeeded' }
      throw err
    }
  }

  /** Applies an account's current ban to late-arriving identifiers without extending the ban. */
  async mirrorActiveBanIdentifiers(userId: SbUserId): Promise<boolean> {
    return await transact(async client => {
      await lockIdentifierModeration(client)
      const activeBan = await getActiveUserBan(userId, client)
      if (!activeBan) return false
      await banAllIdentifiers(
        { users: [userId], timeBanned: activeBan.startTime, bannedUntil: activeBan.endTime },
        client,
      )
      return true
    })
  }

  private async applyBanRequest(
    request: BanRequest,
    checkIdentifiers: boolean,
  ): Promise<IdentifierBanResult> {
    const skipped = await transact(async client => {
      const receipt = await lockBanRequest(request, client)
      if (receipt.banId) return false
      await lockIdentifierModeration(client)
      if (!(await findUserById(request.targetId, client))) {
        throw new httpErrors.NotFound('User not found')
      }

      if (checkIdentifiers) {
        const activeBan = await getActiveUserBan(request.targetId, client)
        if (activeBan) {
          await recordBanRequestBans(request.requestId, activeBan.id, [activeBan.id], client)
          await completeBanRequest(request.requestId, client)
          return true
        }
        const [count] = await countBannedUserIdentifiers(request.targetId, client)
        if (count < MIN_IDENTIFIER_MATCHES || Number(request.endTime) <= Date.now()) {
          // Roll back the provisional receipt so a later observation can schedule a fresh check.
          throw new IdentifierBanNotNeeded()
        }
      }

      if (request.gameId) {
        // Serialize protection with reconciliation and refunds, before bans can end the game.
        await lockGameAndCheckReconciled(client, request.gameId)
        if (await getUserGameRecord(request.targetId, request.gameId, client)) {
          await recordReplayViolation(client, {
            gameId: request.gameId,
            userId: request.targetId,
            details: { kind: 'clientMismatch' },
          })
        } else {
          // Observers belong to the game but do not participate in its results or refunds.
          const game = await getGameRecord(request.gameId, client)
          if (!game?.config.observers?.includes(request.targetId)) {
            throw new httpErrors.BadRequest('User did not participate in this game')
          }
        }
      }

      const connected = await findConnectedUsers(request.targetId, MIN_IDENTIFIER_MATCHES, client)
      const users = [...new Set(connected.concat(request.targetId))]
      const bans = await banUsers(
        { users, endTime: request.endTime, reason: request.reason },
        client,
      )
      const targetBan = bans.find(ban => ban.userId === request.targetId)
      if (!targetBan) throw new Error('Missing target ban')
      await banAllIdentifiers({ users, bannedUntil: request.endTime }, client)
      await recordBanRequestBans(
        request.requestId,
        targetBan.id,
        bans.map(ban => ban.id),
        client,
      )
      return false
    })

    if (skipped) return { status: 'alreadyBanned' }

    // Persist the bans before touching Redis. The receipt serializes concurrent retries, and the
    // original ban row locks prevent a concurrent unban from racing with session removal.
    const banId = await transact(async client => {
      const receipt = await lockBanRequest(request, client)
      if (!receipt.banId || !receipt.banIds) throw new Error('Missing ban receipt')
      if (!receipt.completedAt) {
        const users = await lockActiveBanUsers(receipt.banIds, client)
        if (users.length) await this.clearSessions(users, AbortSignal.timeout(4000))
        await completeBanRequest(request.requestId, client)
      }
      return receipt.banId
    })
    return { status: 'banned', banId }
  }

  private async clearSessions(users: SbUserId[], signal?: AbortSignal): Promise<void> {
    // Delete all the active sessions and close any sockets they have open, so that they're forced
    // to log in again and we don't need to ban check on every operation. This happens after the
    // ban is committed: if it fails partway, the checks on login and matchmaking still catch the
    // user.
    // Commands issued in the same tick are written to Redis as a single pipeline
    const client = signal
      ? this.redis.client.withCommandOptions({ abortSignal: signal })
      : this.redis.client
    const sessionIdLists = await Promise.all(
      users.map(userId => client.sMembers(userSessionsKey(userId))),
    )
    signal?.throwIfAborted()

    const keys: string[] = []
    users.forEach((userId, i) => {
      for (const sessionId of sessionIdLists[i]) {
        const key = sessionKey(userId, sessionId)
        this.deletedSessions.register(key)
        keys.push(key)
      }
      keys.push(userSessionsKey(userId))
    })
    if (signal) {
      // A single command preserves cancellation; Redis pipeline commands don't inherit its signal.
      await client.del(keys)
      signal.throwIfAborted()
    } else {
      const cleanupPipeline = client.multi()
      for (const key of keys) cleanupPipeline.del(key)
      await cleanupPipeline.execAsPipeline()
    }

    for (const userId of users) {
      this.userSocketsManager.getById(userId)?.closeAll()
    }
  }

  /**
   * Lifts a user's ban. Mirrors `enactBan`: the accounts connected to the target by shared
   * identifiers are unbanned alongside it (their bans were applied as a group), and every
   * identifier ban covering any of those accounts' identifiers is expired so nobody in the group is
   * flagged for ban evasion on their next login.
   */
  async enactUnban({
    targetId,
    unbannedBy,
    reason,
  }: {
    targetId: SbUserId
    unbannedBy?: SbUserId
    reason?: string
  }): Promise<{
    /** All bans that were lifted, for the target and any connected accounts. */
    liftedBans: UserBanRow[]
    /** Number of identifier bans that were expired. */
    liftedIdentifierBans: number
  }> {
    // No session or socket cleanup is needed here: a banned user has no active sessions to clear.
    return await transact(async client => {
      await lockIdentifierModeration(client)
      const connectedUsers = await findConnectedUsers(targetId, MIN_IDENTIFIER_MATCHES, client)
      const users = connectedUsers.concat(targetId)
      const now = new Date()

      const liftedBans = await liftUserBans({ users, unbannedBy, reason, now }, client)
      const liftedIdentifierBans = await liftIdentifierBans({ users, now }, client)

      return { liftedBans, liftedIdentifierBans }
    })
  }
}
