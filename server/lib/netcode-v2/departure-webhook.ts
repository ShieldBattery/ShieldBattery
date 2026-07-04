import KoaRouter from '@koa/router'
import Joi from 'joi'
import koaBody from 'koa-body'
import { NetcodeV2DepartureNotification } from '../../../common/games/netcode-v2'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { validateRequest } from '../validation/joi-validator'
import {
  checkDepartureWebhookAuth,
  recordDepartureNotification,
} from './netcode-v2-departure-service'

const departuresThrottle = createThrottle('netcodeV2Departures', {
  rate: 20,
  burst: 40,
  window: 60000,
})

// A small JSON-only body parser, deliberately separate from the app-wide `koaBody()` in app.ts
// (which this route is mounted ahead of): webhook callers send a small JSON payload, never
// multipart/urlencoded, so there's no reason to pay for (or expose) that parsing here.
const departureBody = koaBody({
  json: true,
  multipart: false,
  urlencoded: false,
  text: false,
  jsonLimit: '64kb',
})

const DEPARTURE_BODY_SCHEMA = Joi.object<NetcodeV2DepartureNotification>({
  tenant: Joi.string().required(),
  session: Joi.number().required(),
  externalId: Joi.string(),
  slot: Joi.number().required(),
  externalRef: Joi.string(),
  kind: Joi.string().valid('left', 'dropped').required(),
  reason: Joi.number().required(),
  leaveSeq: Joi.number().required(),
})
  // The coordinator's control protos don't `deny_unknown_fields`, so this endpoint shouldn't
  // either — an old app server shouldn't break on a newer coordinator's extra webhook fields.
  .unknown(true)

/**
 * Registers the rally-point2 coordinator's mid-game departure webhook (`POST
 * /netcode-v2/departures`, relative to the webhook router's mount) onto a webhook router. No
 * login is required — the caller is the trusted coordinator service, not an end user — so
 * authentication is a bearer secret instead of a session; see `netcode-v2-departure-service.ts`
 * for the auth + classification logic this handler delegates to.
 */
export function registerDepartureWebhookRoutes(router: KoaRouter) {
  router.post(
    '/netcode-v2/departures',
    throttleMiddleware(departuresThrottle, ctx => String(ctx.ip)),
    departureBody,
    async ctx => {
      // Auth/feature-gate first, and strictly before body validation: an unset secret must 404
      // regardless of what was POSTed, and a wrong secret must not get a validation-error oracle
      // into the expected body shape.
      const authStatus = checkDepartureWebhookAuth(ctx.get('Authorization'))
      if (authStatus !== null) {
        ctx.status = authStatus
        return
      }

      const { body } = validateRequest(ctx, { body: DEPARTURE_BODY_SCHEMA })
      await recordDepartureNotification(body)
      ctx.status = 204
    },
  )
}
