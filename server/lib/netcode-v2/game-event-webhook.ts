import KoaRouter from '@koa/router'
import Joi from 'joi'
import koaBody from 'koa-body'
import {
  NetcodeV2DepartureNotification,
  NetcodeV2DesyncNotification,
  NetcodeV2GameEvent,
} from '../../../common/games/netcode-v2'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { validateRequest } from '../validation/joi-validator'
import {
  checkGameEventWebhookAuth,
  recordDepartureNotification,
  recordDesyncNotification,
} from './netcode-v2-game-event-service'

const gameEventsThrottle = createThrottle('netcodeV2GameEvents', {
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
const gameEventBody = koaBody({
  json: true,
  multipart: false,
  urlencoded: false,
  text: false,
  jsonLimit: '64kb',
  includeUnparsed: true,
})

// Postgres BIGINT bounds; syncOrdinal is persisted to a BIGINT column, so rejecting fractional or
// out-of-range values here (rather than passing them to the DB and 500ing on every at-least-once
// webhook retry) keeps a malformed/malicious delivery from ever reaching a query.
const MAX_SAFE_BIGINT = Number.MAX_SAFE_INTEGER
// A generous but finite bound on the webhook's `detectedAtMs`/epoch-ms fields, so a wildly
// out-of-range value can't produce `new Date(huge)` -> an Invalid Date that throws downstream (e.g.
// when persisted or formatted) instead of failing validation up front. Year ~2286.
const MAX_EPOCH_MS = 10_000_000_000_000
const MAX_DIVERGED_SLOTS = 16

const DEPARTURE_EVENT_SCHEMA = Joi.object<NetcodeV2DepartureNotification>({
  event: Joi.string().valid('departure').required(),
  tenant: Joi.string().required(),
  session: Joi.number().integer().min(0).required(),
  externalId: Joi.string(),
  slot: Joi.number().integer().min(0).required(),
  externalRef: Joi.string(),
  kind: Joi.string().valid('left', 'dropped').required(),
  reason: Joi.number().integer().min(0).required(),
  leaveSeq: Joi.number().integer().min(0).required(),
})
  // The coordinator's control protos don't `deny_unknown_fields`, so this endpoint shouldn't
  // either — an old app server shouldn't break on a newer coordinator's extra webhook fields.
  .unknown(true)

const DESYNC_EVENT_SCHEMA = Joi.object<NetcodeV2DesyncNotification>({
  event: Joi.string().valid('desync').required(),
  tenant: Joi.string().required(),
  session: Joi.number().integer().min(0).required(),
  externalId: Joi.string(),
  syncOrdinal: Joi.number().integer().min(0).max(MAX_SAFE_BIGINT).required(),
  gameFrame: Joi.number().integer().min(0),
  detectedAtMs: Joi.number().integer().min(0).max(MAX_EPOCH_MS).required(),
  noMajority: Joi.boolean().required(),
  diverged: Joi.array()
    .items(
      Joi.object({
        slot: Joi.number().integer().min(0).required(),
        externalRef: Joi.string(),
      }).unknown(true),
    )
    .max(MAX_DIVERGED_SLOTS)
    .required(),
})
  // See DEPARTURE_EVENT_SCHEMA's comment: same no-`deny_unknown_fields` interop reasoning.
  .unknown(true)

/**
 * Validates a `POST /netcode-v2/game-events` body as one of the `NetcodeV2GameEvent` variants,
 * discriminated by `event`. Joi tries each alternative in order and reports the combined errors if
 * neither matches, so an unrecognized `event` value (or a body missing it) is rejected.
 */
export const GAME_EVENT_BODY_SCHEMA = Joi.alternatives<NetcodeV2GameEvent>(
  DEPARTURE_EVENT_SCHEMA,
  DESYNC_EVENT_SCHEMA,
)

/**
 * Registers the rally-point2 coordinator's mid-game notification webhook (`POST
 * /netcode-v2/game-events`, relative to the webhook router's mount) onto a webhook router. No
 * login is required — the caller is the trusted coordinator service, not an end user — so
 * authentication is an Ed25519 signature over the request rather than a session; see
 * `netcode-v2-game-event-service.ts` for the auth + classification logic this handler delegates to.
 *
 * One endpoint carries both departure and desync notifications (discriminated by `event`) — the
 * coordinator's notice pipe is a single generalized channel rather than one route per event kind.
 */
export function registerGameEventWebhookRoutes(router: KoaRouter) {
  router.post(
    '/netcode-v2/game-events',
    throttleMiddleware(gameEventsThrottle, ctx => String(ctx.ip)),
    gameEventBody,
    async ctx => {
      // Auth/feature-gate first, and strictly before body validation: netcode v2 not being
      // configured must 404 regardless of what was POSTed, and a bad signature must not get a
      // validation-error oracle into the expected body shape. This needs the raw body bytes (not
      // the parsed JSON), which `gameEventBody` above already captured as `ctx.request.rawBody`;
      // that's still just *reading* the body, so it doesn't jump the auth-before-validation order.
      const authStatus = await checkGameEventWebhookAuth(
        ctx.get('x-rp2-timestamp'),
        ctx.get('x-rp2-signature'),
        Buffer.from(ctx.request.rawBody ?? '', 'utf8'),
      )
      if (authStatus !== null) {
        ctx.status = authStatus
        return
      }

      const { body } = validateRequest(ctx, { body: GAME_EVENT_BODY_SCHEMA })
      if (body.event === 'departure') {
        await recordDepartureNotification(body)
      } else {
        await recordDesyncNotification(body)
      }
      ctx.status = 204
    },
  )
}
