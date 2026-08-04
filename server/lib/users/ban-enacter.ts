import { injectable } from 'tsyringe'
import { SbUserId } from '../../../common/users/sb-user-id'
import transact from '../db/transaction'
import { Redis } from '../redis/redis'
import { DeletedSessionRegistry } from '../session/deleted-sessions'
import { sessionKey, userSessionsKey } from '../session/jwt-session-middleware'
import { UserSocketsManager } from '../websockets/socket-groups'
import { banUsers, UserBanRow } from './ban-models'
import { MIN_IDENTIFIER_MATCHES } from './client-ids'
import { banAllIdentifiers, findConnectedUsers } from './user-identifiers'

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

    // Delete all the active sessions and close any sockets they have open, so that they're forced
    // to log in again and we don't need to ban check on every operation. This happens after the
    // ban is committed: if it fails partway, the checks on login and matchmaking still catch the
    // user (see the race condition note above).
    const indexPipeline = this.redis.pipeline()
    for (const userId of users) {
      indexPipeline.smembers(userSessionsKey(userId))
    }
    const indexResults = (await indexPipeline.exec()) ?? []

    const cleanupPipeline = this.redis.pipeline()
    users.forEach((userId, i) => {
      const [err, sessionIds] = indexResults[i] as [Error | null, string[] | undefined]
      if (err) {
        throw err
      }

      for (const sessionId of sessionIds ?? []) {
        const key = sessionKey(userId, sessionId)
        this.deletedSessions.register(key)
        cleanupPipeline.del(key)
      }
      cleanupPipeline.del(userSessionsKey(userId))
    })
    await cleanupPipeline.exec()

    for (const userId of users) {
      this.userSocketsManager.getById(userId)?.closeAll()
    }

    for (const banEntry of banEntries) {
      if (banEntry.userId === targetId) {
        return banEntry
      }
    }

    throw new Error(`Failed to find ban entry for user ${targetId} after banning.`)
  }
}
