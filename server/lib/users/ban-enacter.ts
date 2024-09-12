import { injectable } from 'tsyringe'
import { SbUserId } from '../../../common/users/sb-user.js'
import transact from '../db/transaction.js'
import logger from '../logging/logger.js'
import { Redis } from '../redis/redis.js'
import { DeletedSessionRegistry } from '../session/deleted-sessions.js'
import { UserSocketsManager } from '../websockets/socket-groups.js'
import { banUser, UserBanRow } from './ban-models.js'
import { MIN_IDENTIFIER_MATCHES } from './client-ids.js'
import { SuspiciousIpsService } from './suspicious-ips.js'
import { banAllIdentifiers, findConnectedUsers } from './user-identifiers.js'
import { retrieveIpsForUser } from './user-ips.js'

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
    banRelatedUsers = true,
  }: {
    targetId: SbUserId
    bannedBy?: SbUserId
    banLengthHours: number
    reason?: string
    banRelatedUsers?: boolean
  }): Promise<UserBanRow> {
    return await transact(async client => {
      const [banEntry, allIps] = await Promise.all([
        banUser(
          {
            userId: targetId,
            bannedBy,
            banLengthHours,
            reason,
          },
          client,
        ),
        retrieveIpsForUser(targetId, client),
      ])

      const bannedUntil = new Date()
      bannedUntil.setHours(bannedUntil.getHours() + banLengthHours)
      await Promise.all([
        this.suspiciousIps.markSuspicious(allIps, bannedUntil),
        banAllIdentifiers({ userId: targetId, bannedUntil }, client),
      ])

      // Delete all the active sessions and close any sockets they have open, so that they're forced
      // to log in again and we don't need to ban check on every operation
      const userSessionPattern = `sessions:${targetId}:*`
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

      const pipeline = this.redis.pipeline()
      for (const key of userSessionKeys) {
        this.deletedSessions.register(key)
        pipeline.del(key)
      }
      this.userSocketsManager.getById(targetId)?.closeAll()
      await pipeline.exec()

      if (banRelatedUsers) {
        // TODO(tec27): Should perform the same session deletion + disconnect for these users as
        // well
        const connectedUsers = await findConnectedUsers(targetId, MIN_IDENTIFIER_MATCHES)
        if (connectedUsers.length) {
          Promise.resolve()
            .then(async () => {
              await Promise.all(
                connectedUsers.map(userId =>
                  this.enactBan({
                    targetId: userId,
                    bannedBy,
                    banLengthHours,
                    reason,
                    // We need this or it will ping-pong back and forth between the users forever
                    // and flood the ban table. Trust me on this :)
                    banRelatedUsers: false,
                  }),
                ),
              )
            })
            .catch(err => {
              logger.error({ err }, 'error while banning connected users')
            })
        }
      }

      return banEntry
    })
  }
}
