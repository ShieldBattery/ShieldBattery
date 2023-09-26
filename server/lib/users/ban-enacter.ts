import { injectable } from 'tsyringe'
import { SbUserId } from '../../../common/users/sb-user'
import transact from '../db/transaction'
import logger from '../logging/logger'
import { Redis } from '../redis'
import { DeletedSessionRegistry } from '../session/deleted-sessions'
import { UserSocketsManager } from '../websockets/socket-groups'
import { banUser, UserBanRow } from './ban-models'
import { MIN_IDENTIFIER_MATCHES } from './client-ids'
import { SuspiciousIpsService } from './suspicious-ips'
import { banAllIdentifiers, findConnectedUsers } from './user-identifiers'
import { retrieveIpsForUser } from './user-ips'

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
      const userSessionsKey = `sessions:${targetId}:*`
      const userSessionKeys = await this.redis.keys(userSessionsKey)
      const pipeline = this.redis.pipeline()
      for (const key of userSessionKeys) {
        this.deletedSessions.register(key)
        pipeline.del(key)
      }
      this.userSocketsManager.getById(targetId)?.closeAll()
      await pipeline.exec()

      if (banRelatedUsers) {
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
