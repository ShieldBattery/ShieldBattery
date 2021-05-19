import Router, { RouterContext } from '@koa/router'
import Joi from 'joi'
import { container } from 'tsyringe'
import {
  ClearNotificationsServerBody,
  ClearNotificationsServerPayload,
  MarkNotificationsReadServerBody,
} from '../../../common/notifications'
import { httpApi, HttpApi } from '../http/http-api'
import ensureLoggedIn from '../session/ensure-logged-in'
import { validateRequest } from '../validation/joi-validator'
import NotificationService from './notification-service'

@httpApi()
export class NotificationApi extends HttpApi {
  constructor() {
    super('/notifications')
    // NOTE(tec27): Ensure the service is initialized
    container.resolve(NotificationService)
  }

  applyRoutes(router: Router): void {
    router
      .use(ensureLoggedIn)
      .post('/clear', clearNotifications)
      .post('/read', markNotificationsRead)
  }
}

async function clearNotifications(ctx: RouterContext) {
  const { body } = validateRequest(ctx, {
    body: Joi.object<ClearNotificationsServerBody>({
      timestamp: Joi.number(),
    }),
  })

  const timestamp = body.timestamp ?? Date.now()
  const notificationService = container.resolve(NotificationService)
  notificationService.clearBefore(ctx.session!.userId, new Date(timestamp))

  ctx.body = {
    timestamp,
  } as ClearNotificationsServerPayload
}

async function markNotificationsRead(ctx: RouterContext) {
  const { body } = validateRequest(ctx, {
    body: Joi.object<MarkNotificationsReadServerBody>({
      notificationIds: Joi.array().items(Joi.string().required()).min(1).required(),
    }),
  })

  const notificationService = container.resolve(NotificationService)
  notificationService.markRead(ctx.session!.userId, body.notificationIds)

  ctx.status = 204
}
