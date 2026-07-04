import { singleton } from 'tsyringe'
import { NotificationType } from '../../../common/notifications'
import { urlPath } from '../../../common/urls'
import { SbUserId } from '../../../common/users/sb-user-id'
import { DiscordWebhookNotifier } from '../discord/webhook-notifier'
import logger from '../logging/logger'
import NotificationService from '../notifications/notification-service'
import { RedisSubscriber } from '../redis/redis'
import { findUsersById } from '../users/user-model'

/** Labels for the DB reason strings (snake_case, straight from server-rs), for the Discord message. */
/* eslint-disable camelcase */
const REASON_LABELS: Record<string, string> = {
  cheating: 'Cheating or exploiting',
  abandoning: 'Left the game',
  griefing: 'Griefing',
  abusive_chat: 'Abusive chat',
  other: 'Other',
}
/* eslint-enable camelcase */

/** How much of the free-text details to include in the Discord message. */
const DISCORD_DETAILS_MAX_LENGTH = 200

/**
 * Listens for game-report events published by the Rust server (server-rs owns the reporting feature,
 * but the notification/webhook machinery lives here) and reacts to them: a new report fires the
 * moderation Discord webhook (like bug reports do), and an actioned report notifies the reporter(s).
 *
 * This has no HTTP API of its own, so it's eagerly constructed in `routes.ts` (like `NewsService`)
 * to make sure the Redis subscription is set up at boot.
 */
@singleton()
export class GameReportNotificationService {
  constructor(
    private redisSubscriber: RedisSubscriber,
    private notificationService: NotificationService,
    private webhookNotifier: DiscordWebhookNotifier,
  ) {
    this.redisSubscriber
      .subscribe('gameReport', message => {
        switch (message.type) {
          case 'reportCreated':
            this.notifyDiscordOfReport(message.data).catch(err => {
              logger.error({ err }, 'failed to send Discord webhook for new game report')
            })
            break
          case 'reportActioned':
            // The notification is intentionally content-free (no player, game, or punishment
            // details) as an anti-retaliation measure; the interesting decision — who to notify —
            // was already made in server-rs.
            Promise.all(
              message.data.reporterIds.map(userId =>
                this.notificationService.addNotification({
                  userId,
                  data: { type: NotificationType.GameReportActioned },
                }),
              ),
            ).catch(err => {
              logger.error({ err }, 'failed to create game report actioned notifications')
            })
            break
          default:
            message satisfies never
            logger.warn(`received an unknown gameReport message type: ${(message as any).type}`)
        }
      })
      .catch(err => {
        logger.error({ err }, 'failed to subscribe to Redis gameReport messages')
      })
  }

  private async notifyDiscordOfReport({
    reportId,
    reporterId,
    reportedUserId,
    reason,
    details,
  }: {
    reportId: string
    reporterId: SbUserId
    reportedUserId: SbUserId
    reason: string
    details?: string
  }): Promise<void> {
    const users = await findUsersById([reporterId, reportedUserId])
    const nameById = new Map(users.map(u => [u.id, u.name]))
    const reporterName = nameById.get(reporterId) ?? `User ${reporterId}`
    const reportedName = nameById.get(reportedUserId) ?? `User ${reportedUserId}`
    const reasonLabel = REASON_LABELS[reason] ?? reason

    const sanitizedDetails = details?.replace(/[\r\n]+/g, ' ')
    const detailsLine =
      sanitizedDetails && sanitizedDetails.length
        ? `\n\n> ${
            sanitizedDetails.length > DISCORD_DETAILS_MAX_LENGTH
              ? sanitizedDetails.slice(0, DISCORD_DETAILS_MAX_LENGTH) + '…'
              : sanitizedDetails
          }`
        : ''

    await this.webhookNotifier.notify({
      content:
        `New game report: ${reporterName} reported ${reportedName} for ${reasonLabel}` +
        detailsLine +
        `\n\n${process.env.SB_CANONICAL_HOST}${urlPath`/admin/game-reports/${reportId}`}`,
    })
  }
}
