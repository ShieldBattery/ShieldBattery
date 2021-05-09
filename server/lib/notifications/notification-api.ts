import Router, { RouterContext } from '@koa/router'
import Joi from 'joi'
import { MarkNotificationsReadServerBody } from '../../../common/notifications'
import { httpApi, HttpApi } from '../http/http-api'
import ensureLoggedIn from '../session/ensure-logged-in'
import { validateRequest } from '../validation/joi-validator'
import { clear, markRead } from './notification-model'

@httpApi()
export class NotificationApi extends HttpApi {
  constructor() {
    super('/notifications')
  }

  applyRoutes(router: Router): void {
    router
      .use(ensureLoggedIn)
      .post('/clear', clearNotifications)
      .post('/read', markNotificationsRead)
  }
}

async function clearNotifications(ctx: RouterContext) {
  await clear(ctx.session!.userId)

  ctx.status = 204
}

async function markNotificationsRead(ctx: RouterContext) {
  const { body } = validateRequest(ctx, {
    body: Joi.object<MarkNotificationsReadServerBody>({
      notificationIds: Joi.array().items(Joi.string().required()).min(1).required(),
    }),
  })

  await markRead(ctx.session!.userId, body.notificationIds)

  ctx.status = 204
}
