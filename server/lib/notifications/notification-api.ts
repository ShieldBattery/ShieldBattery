import { RouterContext } from '@koa/router'
import Joi from 'joi'
import {
  ClearNotificationsServerRequest,
  ClearNotificationsServerResponse,
  MarkNotificationsReadServerRequest,
} from '../../../common/notifications.js'
import { httpApi, httpBeforeAll } from '../http/http-api.js'
import { httpPost } from '../http/route-decorators.js'
import ensureLoggedIn from '../session/ensure-logged-in.js'
import { validateRequest } from '../validation/joi-validator.js'
import NotificationService from './notification-service.js'

@httpApi('/notifications')
@httpBeforeAll(ensureLoggedIn)
export class NotificationApi {
  constructor(private notificationService: NotificationService) {}

  @httpPost('/clear')
  async clearNotifications(ctx: RouterContext): Promise<ClearNotificationsServerResponse> {
    const { body } = validateRequest(ctx, {
      body: Joi.object<ClearNotificationsServerRequest>({
        timestamp: Joi.number(),
      }),
    })

    const timestamp = body.timestamp ?? Date.now()
    await this.notificationService.clearBefore(ctx.session!.user!.id, new Date(timestamp))

    return {
      timestamp,
    }
  }

  @httpPost('/read')
  async markNotificationsRead(ctx: RouterContext): Promise<void> {
    const { body } = validateRequest(ctx, {
      body: Joi.object<MarkNotificationsReadServerRequest>({
        notificationIds: Joi.array().items(Joi.string().required()).min(1).required(),
      }),
    })

    await this.notificationService.markRead(ctx.session!.user!.id, body.notificationIds)

    ctx.status = 204
  }
}
