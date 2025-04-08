import { injectable } from 'tsyringe'
import { SbUserId } from '../../../common/users/sb-user-id'
import transact from '../db/transaction'
import { Redis } from '../redis/redis'
import { DeletedSessionRegistry } from '../session/deleted-sessions'
import { UserSocketsManager } from '../websockets/socket-groups'
import { banUsers, UserBanRow } from './ban-models'
import { MIN_IDENTIFIER_MATCHES } from './client-ids'
import { SuspiciousIpsService } from './suspicious-ips'
import { banAllIdentifiers, findConnectedUsers } from './user-identifiers'
import { retrieveIpsForUsers } from './user-ips'

@injectable()
export class BanEnacter {
  constructor(
    private redis: Redis,
    private suspiciousIps: SuspiciousIpsService,
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
    banLengthHours,
    reason,
  }: {
    targetId: SbUserId
    bannedBy?: SbUserId
    banLengthHours: number
    reason?: string
  }): Promise<UserBanRow> {
    return await transact(async client => {
      // NOTE(tec27): This does have a potential race condition, where if a user logged in on an
      // account that wasn't previously connected between the time we retrieve this and the time
      // we enact the ban (below), we wouldn't ban them. I don't think this is very likely to
      // happen, though, and they would get banned shortly after anyway (because of the checks
      // on login and matchmaking, etc.).
      const connectedUsers = await findConnectedUsers(
        targetId,
        MIN_IDENTIFIER_MATCHES,
        true /* filterBrowserPrint */,
        client,
      )
      const users = connectedUsers.concat(targetId)

      const bannedUntil = new Date()
      bannedUntil.setHours(bannedUntil.getHours() + banLengthHours)
      const [banEntries, allIps] = await Promise.all([
        banUsers(
          {
            users,
            bannedBy,
            banLengthHours,
            reason,
          },
          client,
        ),
        retrieveIpsForUsers(users, client),
      ])

      await Promise.all([
        this.suspiciousIps.markSuspicious(allIps, bannedUntil),
        banAllIdentifiers({ users, bannedUntil }, client),
      ])

      // Delete all the active sessions and close any sockets they have open, so that they're forced
      // to log in again and we don't need to ban check on every operation
      const pipeline = this.redis.pipeline()

      for (const userId of users) {
        const userSessionPattern = `sessions:${userId}:*`
        let [cursor, userSessionKeys] = await this.redis.scan(
          0,
          'MATCH',
          userSessionPattern,
          'COUNT',
          10,
        )
        while (cursor !== '0') {
          const [nextCursor, keys] = await this.redis.scan(
            cursor,
            'MATCH',
            userSessionPattern,
            'COUNT',
            10,
          )
          cursor = nextCursor
          userSessionKeys = userSessionKeys.concat(keys)
        }

        for (const key of userSessionKeys) {
          this.deletedSessions.register(key)
          pipeline.del(key)
        }
      }
      await pipeline.exec()

      for (const userId of users) {
        this.userSocketsManager.getById(userId)?.closeAll()
      }

      for (const banEntry of banEntries) {
        if (banEntry.userId === targetId) {
          return banEntry
        }
      }

      throw new Error(`Failed to find ban entry for user ${targetId} after banning.`)
    })
  }
}
