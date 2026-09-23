import { RouterContext } from '@koa/router'
import Joi from 'joi'
import { ReportClientIdleRequest } from '../../../common/users/availability'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpBefore, httpPut } from '../http/route-decorators'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware, { throttleByUser } from '../throttle/middleware'
import { validateRequest } from '../validation/joi-validator'
import { AvailabilityService } from './availability-service'

// A client only reports on idle transitions and reconnects, so this is generous for any real
// client (and a user may have a few of them).
const clientIdleThrottle = createThrottle('clientidle', {
  rate: 20,
  burst: 40,
  window: 60000,
})

@httpApi('/availability')
@httpBeforeAll(ensureLoggedIn)
export class AvailabilityApi {
  constructor(private availabilityService: AvailabilityService) {}

  @httpPut('/client-idle')
  @httpBefore(throttleMiddleware(clientIdleThrottle, throttleByUser))
  async reportClientIdle(ctx: RouterContext): Promise<void> {
    const {
      body: { clientId, idle },
    } = validateRequest(ctx, {
      body: Joi.object<ReportClientIdleRequest>({
        clientId: Joi.string().required(),
        idle: Joi.boolean().required(),
      }).required(),
    })

    this.availabilityService.setClientIdle(ctx.session!.user.id, clientId, idle)
    ctx.status = 204
  }
}
