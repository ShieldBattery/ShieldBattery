import { RouterContext } from '@koa/router'
import Joi from 'joi'
import {
  ClearNotificationsServerRequest,
  ClearNotificationsServerResponse,
  MarkNotificationsReadServerRequest,
} from '../../../common/notifications'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpPost } from '../http/route-decorators'
import ensureLoggedIn from '../session/ensure-logged-in'
import { validateRequest } from '../validation/joi-validator'
import NotificationService from './notification-service'

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
    this.notificationService.clearBefore(ctx.session!.userId, new Date(timestamp))

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

    this.notificationService.markRead(ctx.session!.userId, body.notificationIds)

    ctx.status = 204
  }
}
