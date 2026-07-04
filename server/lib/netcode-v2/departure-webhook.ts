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
// `includeUnparsed` keeps the exact raw body bytes around (as `ctx.request.rawBody`) alongside the
// parsed JSON, since signature verification must run over exactly what was sent, not a
// re-serialization of the parsed value.
const departureBody = koaBody({
  json: true,
  multipart: false,
  urlencoded: false,
  text: false,
  jsonLimit: '64kb',
  includeUnparsed: true,
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
 * authentication is an Ed25519 signature over the request rather than a session; see
 * `netcode-v2-departure-service.ts` for the auth + classification logic this handler delegates to.
 */
export function registerDepartureWebhookRoutes(router: KoaRouter) {
  router.post(
    '/netcode-v2/departures',
    throttleMiddleware(departuresThrottle, ctx => String(ctx.ip)),
    departureBody,
    async ctx => {
      // Auth/feature-gate first, and strictly before body validation: an unset/malformed pubkey
      // must 404 regardless of what was POSTed, and a bad signature must not get a
      // validation-error oracle into the expected body shape. This needs the raw body bytes (not
      // the parsed JSON), which `departureBody` above already captured as `ctx.request.rawBody`;
      // that's still just *reading* the body, so it doesn't jump the auth-before-validation order.
      const authStatus = checkDepartureWebhookAuth(
        ctx.get('x-rp2-timestamp'),
        ctx.get('x-rp2-signature'),
        Buffer.from(ctx.request.rawBody ?? '', 'utf8'),
      )
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
