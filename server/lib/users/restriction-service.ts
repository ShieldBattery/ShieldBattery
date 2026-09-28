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
  getActiveRestrictionsForUsers,
  getActiveUserRestrictions,
  liftIdentifierRestrictions,
  liftUserRestrictions,
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

function toRestrictionsChangedEvent(
  activeRestrictions: ReadonlyArray<UserRestriction>,
): RestrictionEvent {
  return {
    type: 'restrictionsChanged',
    restrictions: activeRestrictions.map(r => ({
      kind: r.kind,
      endTime: Number(r.endTime),
      reason: r.reason,
    })),
  }
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
        return toRestrictionsChangedEvent(await getActiveUserRestrictions(user.userId))
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

  /**
   * Returns the end time (in ms) of the user's currently active restriction of `kind` (the
   * last-expiring one), or `undefined` if they have no active restriction of that kind.
   */
  async getActiveRestrictionEndTime(
    userId: SbUserId,
    kind: RestrictionKind,
  ): Promise<number | undefined> {
    const restrictions = await getActiveUserRestrictions(userId)
    const match = restrictions.find(r => r.kind === kind)
    return match ? Number(match.endTime) : undefined
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
    reason?: RestrictionReason
    restrictedBy?: SbUserId
    adminNotes?: string
  }) {
    const restrictionEntries = await transact(async client => {
      const connectedUsers = await findConnectedUsers(targetId, MIN_IDENTIFIER_MATCHES, client)
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

  /**
   * Lifts the target's restriction of `kind`. Mirrors `applyRestriction`: the accounts connected to
   * the target by shared identifiers are lifted alongside it (the restriction was applied to them as
   * a group), and every identifier restriction of that kind on their identifiers is expired so it
   * isn't re-applied on their next login. Other restriction kinds are left alone. Returns the
   * restrictions that were lifted, for the target and any connected accounts.
   */
  async liftRestriction({
    targetId,
    kind,
    liftedBy,
    reason,
  }: {
    targetId: SbUserId
    kind: RestrictionKind
    liftedBy?: SbUserId
    reason?: string
  }): Promise<UserRestriction[]> {
    const liftedRestrictions = await transact(async client => {
      const connectedUsers = await findConnectedUsers(targetId, MIN_IDENTIFIER_MATCHES, client)
      const users = connectedUsers.concat(targetId)
      const now = new Date(this.clock.now())

      const lifted = await liftUserRestrictions({ users, kind, liftedBy, reason, now }, client)
      await liftIdentifierRestrictions({ users, kind, now }, client)

      return lifted
    })

    await this.publishActiveRestrictions(liftedRestrictions.map(r => r.userId))

    return liftedRestrictions
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

  /**
   * Sends each of `users` their full set of active restrictions. Clients replace their restrictions
   * with the set in the event, so it must never be a partial set.
   */
  private async publishActiveRestrictions(users: ReadonlyArray<SbUserId>) {
    const uniqueUsers = Array.from(new Set(users))
    if (!uniqueUsers.length) {
      return
    }

    const activeByUser = await getActiveRestrictionsForUsers(uniqueUsers)
    for (const userId of uniqueUsers) {
      this.publisher.publish(
        getPath(userId),
        toRestrictionsChangedEvent(activeByUser.get(userId) ?? []),
      )
    }
  }

  private async notifyRestrictionChange(restrictions: UserRestriction[]) {
    await this.publishActiveRestrictions(restrictions.map(r => r.userId))
    await Promise.all(
      restrictions.map(r =>
        this.notificationService.addNotification({
          userId: r.userId,
          data: {
            type: NotificationType.UserRestricted,
            kind: r.kind,
            endTime: Number(r.endTime),
            reason: r.reason,
          },
        }),
      ),
    )
  }
}
