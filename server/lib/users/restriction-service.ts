import { singleton } from 'tsyringe'
import { NotificationType } from '../../../common/notifications'
import { urlPath } from '../../../common/urls'
import {
  ALL_RESTRICTION_KINDS,
  RestrictionEvent,
  RestrictionKind,
  RestrictionReason,
} from '../../../common/users/restrictions'
import { SbUserId } from '../../../common/users/sb-user-id'
import transact from '../db/transaction'
import NotificationService from '../notifications/notification-service'
import { Clock } from '../time/clock'
import { UserSocketsManager } from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'
import { ClientIdentifierBuffer, MIN_IDENTIFIER_MATCHES } from './client-ids'
import {
  checkMultipleRestrictions,
  checkRestriction,
  countRestrictedUserIdentifiers,
  getActiveUserRestrictions,
  mirrorRestrictionsToIdentifiers,
  restrictAllIdentifiers,
  restrictUsers,
  retrieveRestrictionHistory,
  UserRestriction,
} from './restriction-models'
import { findConnectedUsers } from './user-identifiers'

function getPath(userId: SbUserId) {
  return urlPath`/restrictions/${userId}`
}

@singleton()
export class RestrictionService {
  constructor(
    private userSockets: UserSocketsManager,
    private publisher: TypedPublisher<RestrictionEvent>,
    private clock: Clock,
    private notificationService: NotificationService,
  ) {
    this.userSockets.on('newUser', user => {
      user.subscribe<RestrictionEvent>(getPath(user.userId), async () => {
        const restrictions = await getActiveUserRestrictions(user.userId)
        return {
          type: 'restrictionsChanged',
          restrictions: restrictions.map(r => ({
            kind: r.kind,
            endTime: Number(r.endTime),
            reason: r.reason,
          })),
        }
      })
    })
  }

  /** Returns true if the user currently has a restriction of the specified kind */
  async isRestricted(userId: SbUserId, kind: RestrictionKind): Promise<boolean> {
    return await checkRestriction({ userId, kind })
  }

  /** Returns the subset of `users` that currently have a restriction of `kind`. */
  async checkMultipleRestrictions(
    users: ReadonlyArray<SbUserId>,
    kind: RestrictionKind,
  ): Promise<SbUserId[]> {
    return await checkMultipleRestrictions({ users, kind })
  }

  async applyRestriction({
    targetId,
    kind,
    endTime,
    reason,
    restrictedBy,
    adminNotes,
  }: {
    targetId: SbUserId
    kind: RestrictionKind
    endTime: Date
    reason: RestrictionReason
    restrictedBy?: SbUserId
    adminNotes?: string
  }) {
    const restrictionEntries = await transact(async client => {
      const connectedUsers = await findConnectedUsers(
        targetId,
        MIN_IDENTIFIER_MATCHES,
        true /* filterBrowserPrint */,
        client,
      )
      const users = connectedUsers.concat(targetId)

      const startTime = new Date(this.clock.now())
      const restrictionEntries = await restrictUsers(
        {
          users,
          kind,
          startTime,
          endTime,
          restrictedBy,
          reason,
          adminNotes,
        },
        client,
      )
      await restrictAllIdentifiers(
        {
          originalTarget: targetId,
          users,
          kind,
          startTime,
          endTime,
          restrictedBy,
          reason,
          adminNotes,
        },
        client,
      )

      return restrictionEntries
    })

    await this.notifyRestrictionChange(restrictionEntries)

    const result = restrictionEntries.find(r => r.userId === targetId)
    if (!result) {
      // This indicates something is wrong with our query
      throw new Error(`Could not find a restriction entry for the target user`)
    }

    return result
  }

  async getUserRestrictionHistory({
    userId,
    limit,
  }: {
    userId: SbUserId
    limit?: number
  }): Promise<UserRestriction[]> {
    return await retrieveRestrictionHistory({ userId, limit })
  }

  async handleNewIdentifiers(
    userId: SbUserId,
    identifiers: ReadonlyArray<ClientIdentifierBuffer>,
  ): Promise<void> {
    const restrictions = await getActiveUserRestrictions(userId)
    if (restrictions.length > 0) {
      await mirrorRestrictionsToIdentifiers({
        restrictions,
        identifiers,
      })
    }

    const oldRestrictions = new Map(restrictions.map(r => [r.kind, r]))
    // TODO(tec27): Would probably be good to make a query that can return all of the kinds at once
    // when we have more kinds
    const newRestrictions = (
      await Promise.all(
        ALL_RESTRICTION_KINDS.map(async kind => {
          const info = await countRestrictedUserIdentifiers({ userId, kind })
          return [kind, info] as const
        }),
      )
    ).filter(([kind, info]) => {
      if (!info) {
        return false
      }
      const old = oldRestrictions.get(kind)
      return old ? old.endTime < info.latestEnd : true
    })

    if (newRestrictions.length > 0) {
      const entries = await transact(async client => {
        const startTime = new Date(this.clock.now())

        let restrictionEntries: UserRestriction[] = []
        for (const [kind, _info] of newRestrictions) {
          const info = _info!
          restrictionEntries = restrictionEntries.concat(
            await restrictUsers(
              {
                users: [userId],
                kind,
                startTime,
                endTime: info.latestEnd,
                restrictedBy: info.restrictedBy,
                reason: info.reason,
              },
              client,
            ),
          )
          await restrictAllIdentifiers(
            {
              originalTarget: info.firstUserId,
              users: [userId],
              kind,
              startTime,
              endTime: info.latestEnd,
              restrictedBy: info.restrictedBy,
              reason: info.reason,
            },
            client,
          )
        }

        return restrictionEntries
      })

      await this.notifyRestrictionChange(entries)
    }
  }

  private async notifyRestrictionChange(restrictions: UserRestriction[]) {
    const notificationPromises: Array<Promise<void>> = []
    for (const r of restrictions) {
      this.publisher.publish(getPath(r.userId), {
        type: 'restrictionsChanged',
        restrictions: [
          {
            kind: r.kind,
            endTime: Number(r.endTime),
            reason: r.reason,
          },
        ],
      })
      notificationPromises.push(
        this.notificationService.addNotification({
          userId: r.userId,
          data: {
            type: NotificationType.UserRestricted,
            kind: r.kind,
            endTime: Number(r.endTime),
            reason: r.reason,
          },
        }),
      )
    }

    await Promise.all(notificationPromises)
  }
}
