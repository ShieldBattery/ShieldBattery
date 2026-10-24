import httpErrors from 'http-errors'
import { injectable } from 'tsyringe'
import { SbUserId } from '../../../common/users/sb-user-id'
import transact from '../db/transaction'
import { Redis } from '../redis/redis'
import { DeletedSessionRegistry } from '../session/deleted-sessions'
import { sessionKey, userSessionsKey } from '../session/jwt-session-middleware'
import { UserSocketsManager } from '../websockets/socket-groups'
import { banUsers, liftUserBans, lockActiveBanUsers, UserBanRow } from './ban-models'
import {
  BanRequest,
  completeBanRequest,
  lockBanRequest,
  recordBanRequestBans,
} from './ban-request-models'
import { MIN_IDENTIFIER_MATCHES } from './client-ids'
import { banAllIdentifiers, findConnectedUsers, liftIdentifierBans } from './user-identifiers'
import { findUserById } from './user-model'

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
    await transact(async client => {
      const receipt = await lockBanRequest(request, client)
      if (receipt.banId) return
      if (!(await findUserById(request.targetId, client))) {
        throw new httpErrors.NotFound('User not found')
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
    })

    // Persist the bans before touching Redis. The receipt serializes concurrent retries, and the
    // original ban row locks prevent a concurrent unban from racing with session removal.
    return await transact(async client => {
      const receipt = await lockBanRequest(request, client)
      if (!receipt.banId || !receipt.banIds) throw new Error('Missing ban receipt')
      if (!receipt.completedAt) {
        const users = await lockActiveBanUsers(receipt.banIds, client)
        if (users.length) await this.clearSessions(users, AbortSignal.timeout(4000))
        await completeBanRequest(request.requestId, client)
      }
      return receipt.banId
    })
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
      const connectedUsers = await findConnectedUsers(targetId, MIN_IDENTIFIER_MATCHES, client)
      const users = connectedUsers.concat(targetId)
      const now = new Date()

      const liftedBans = await liftUserBans({ users, unbannedBy, reason, now }, client)
      const liftedIdentifierBans = await liftIdentifierBans({ users, now }, client)

      return { liftedBans, liftedIdentifierBans }
    })
  }
}
