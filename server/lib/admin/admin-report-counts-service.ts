import { singleton } from 'tsyringe'
import { ReadonlyDeep } from 'type-fest'
import {
  ADMIN_REPORT_COUNT_MAX,
  ADMIN_REPORT_COUNT_WINDOW_MS,
  AdminReportCountsEvent,
  adminReportCountsPath,
  AdminReportKind,
} from '../../../common/admin-report-counts'
import { SbPermissions } from '../../../common/users/permissions'
import { listRecentUnresolvedBugReportTimes } from '../bugs/bugs-model'
import { listRecentPendingReviewRequestTimes } from '../games/game-models'
import { listRecentUnresolvedGameReportTimes } from '../games/game-reports-models'
import logger from '../logging/logger'
import { getPermissions } from '../models/permissions'
import { RedisSubscriber } from '../redis/redis'
import { Clock } from '../time/clock'
import { UserSocketsGroup, UserSocketsManager } from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'

const KIND_PERMISSIONS: Record<AdminReportKind, keyof SbPermissions> = {
  bugReports: 'manageBugReports',
  gameReports: 'manageGameReports',
  reviewRequests: 'manageGameReports',
}

const ALL_KINDS = Object.keys(KIND_PERMISSIONS) as AdminReportKind[]

const KIND_QUERIES: Record<
  AdminReportKind,
  (options: { since: Date; limit: number }) => Promise<Date[]>
> = {
  bugReports: listRecentUnresolvedBugReportTimes,
  gameReports: listRecentUnresolvedGameReportTimes,
  reviewRequests: listRecentPendingReviewRequestTimes,
}

/**
 * Pushes the recent unresolved bug report, game report and game review request counts to connected
 * admins. Each report kind has
 * its own socket path, and only users holding that kind's permission are subscribed to it.
 */
@singleton()
export class AdminReportCountsService {
  /** Kinds with a refresh in flight, mapped to whether another refresh was requested meanwhile. */
  private refreshing = new Map<AdminReportKind, boolean>()

  constructor(
    private clock: Clock,
    private publisher: TypedPublisher<AdminReportCountsEvent>,
    private userSocketsManager: UserSocketsManager,
    private redisSubscriber: RedisSubscriber,
  ) {
    this.userSocketsManager.on('newUser', userSockets => {
      getPermissions(userSockets.userId)
        .then(permissions => {
          if (userSockets.sockets.size) {
            this.applySubscriptions(userSockets, permissions)
          }
        })
        .catch(err => {
          logger.error({ err }, 'failed to subscribe user to admin report counts')
        })
    })

    this.redisSubscriber
      .subscribe('gameReport', message => {
        switch (message.type) {
          case 'reportCreated':
          case 'reportResolved':
            this.refresh('gameReports')
            break
          case 'reportActioned':
            break
          default:
            message satisfies never
        }
      })
      .catch(err => {
        logger.error({ err }, 'failed to subscribe to Redis gameReport messages')
      })

    this.redisSubscriber
      .subscribe('user', message => {
        if (message.type === 'permissionsChanged') {
          const userSockets = this.userSocketsManager.getById(message.data.userId)
          if (userSockets) {
            this.applySubscriptions(userSockets, message.data.permissions)
          }
        }
      })
      .catch(err => {
        logger.error({ err }, 'failed to subscribe to Redis user messages')
      })
  }

  /**
   * Re-reads the counts for `kind` and publishes them to every subscribed admin. Calls made while
   * a refresh is running collapse into a single follow-up refresh, so bursts (e.g. resolving a
   * batch of sibling reports) don't issue a query per event.
   */
  refresh(kind: AdminReportKind) {
    if (this.refreshing.has(kind)) {
      this.refreshing.set(kind, true)
      return
    }

    this.refreshing.set(kind, false)
    this.getEvent(kind)
      .then(event => {
        this.publisher.publish(adminReportCountsPath(kind), event)
      })
      .catch(err => {
        logger.error({ err }, `failed to refresh admin report counts for ${kind}`)
      })
      .finally(() => {
        const again = this.refreshing.get(kind)
        this.refreshing.delete(kind)
        if (again) {
          this.refresh(kind)
        }
      })
  }

  private applySubscriptions(
    userSockets: UserSocketsGroup,
    permissions: ReadonlyDeep<SbPermissions> | undefined,
  ) {
    for (const kind of ALL_KINDS) {
      const path = adminReportCountsPath(kind)
      if (permissions?.[KIND_PERMISSIONS[kind]]) {
        userSockets.subscribe<AdminReportCountsEvent>(path, () => this.getEvent(kind))
      } else {
        userSockets.unsubscribe(path)
      }
    }
  }

  private async getEvent(kind: AdminReportKind): Promise<AdminReportCountsEvent> {
    const times = await KIND_QUERIES[kind]({
      since: new Date(this.clock.now() - ADMIN_REPORT_COUNT_WINDOW_MS),
      limit: ADMIN_REPORT_COUNT_MAX,
    })
    return { kind, createdAt: times.map(t => t.getTime()) }
  }
}
