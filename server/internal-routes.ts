import KoaRouter from '@koa/router'
import Koa from 'koa'
import { registerInternalBugReportRoutes } from './lib/bugs/internal-bug-report-routes'
import { registerInternalGameArtifactRoutes } from './lib/games/internal-game-artifact-routes'

/**
 * Builds a middleware that owns every request under `/internal`: service-to-service endpoints for
 * trusted machine callers on the private network/tailnet (currently: Adjutant's bug report and
 * game artifact access; future internal consumers should register their routes here too).
 *
 * Mounted in app.ts *ahead of* the app's normal middleware chain (canonical-host redirects,
 * CSRF/origin checks, cookie/JWT session handling, CORS, security headers, static file serving,
 * etc.) — callers are trusted internal services, not browsers, so that machinery is either
 * useless to them or actively in the way.
 *
 * These routes have no application-level authentication. The authorization boundary is the
 * network: the app-server port must only be reachable via the Docker/private/Tailscale path
 * (public traffic terminates at nginx), with Tailscale ACLs restricting which nodes can reach it.
 * As defense in depth this middleware also rejects any request carrying `X-Forwarded-For` — the
 * same convention as `/metrics` — since nginx always appends that header while direct
 * private-network callers never send it. The header check alone is NOT an adequate boundary; it
 * only backstops the network placement.
 */
export function internalRoutesMiddleware(): Koa.Middleware {
  const router = new KoaRouter({ prefix: '/internal' })
  registerInternalBugReportRoutes(router)
  registerInternalGameArtifactRoutes(router)

  const routes = router.routes() as Koa.Middleware
  const allowedMethods = router.allowedMethods() as Koa.Middleware

  return async (ctx, next) => {
    if (ctx.path !== '/internal' && !ctx.path.startsWith('/internal/')) {
      await next()
      return
    }

    // We only allow internal-route access through direct (tailscale/private-network) connections,
    // not the nginx forward; see the doc comment above.
    if ('x-forwarded-for' in ctx.headers) {
      ctx.throw(403, 'Forbidden')
    }

    // The outer `next` is deliberately never called: anything under /internal that doesn't match
    // a route 404s (or 405s via allowedMethods) here rather than falling through to the public
    // route stack.
    await routes(ctx, async () => allowedMethods(ctx, async () => {}))
  }
}
