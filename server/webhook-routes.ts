import KoaRouter from '@koa/router'
import { registerGameEventWebhookRoutes } from './lib/netcode-v2/game-event-webhook'

/**
 * Builds the router for machine-caller webhook endpoints (currently: the rally-point2
 * coordinator's mid-game notification webhook, covering both departure and desync events; future
 * webhook consumers should register their routes here too).
 *
 * Mounted in app.ts *ahead of* the app's normal middleware chain (CSRF/origin checks, cookie/JWT
 * session handling, CORS, security headers, static file serving, the shared body parser, etc.) —
 * webhook callers are trusted external services authenticating with their own bearer secrets, not
 * browsers, so that machinery is either useless to them or actively in the way. Each route parses
 * its own (JSON-only) body rather than relying on the app-wide body parser, since this router runs
 * before it.
 */
export function createWebhookRoutes(): KoaRouter {
  const router = new KoaRouter({ prefix: '/webhooks' })

  registerGameEventWebhookRoutes(router)

  return router
}
