import KoaRouter from '@koa/router'
import Koa from 'koa'
import './internal-apis'
import {
  applyApiRoutes,
  INTERNAL_BASE_PATH,
  RegisteredApi,
  resolveAllInternalApis,
} from './lib/http/http-api'

/**
 * Builds a middleware that owns every request under `INTERNAL_BASE_PATH`: service-to-service
 * endpoints for trusted machine callers on the private network/tailnet (currently: Adjutant's bug
 * report and game artifact access). Endpoints are classes decorated with `@internalApi`, listed
 * in internal-apis.ts so they register at boot.
 *
 * Mounted in app.ts *ahead of* the app's normal middleware chain (canonical-host redirects,
 * CSRF/origin checks, cookie/JWT session handling, CORS, security headers, static file serving,
 * the shared body parser, etc.) — callers are trusted internal services, not browsers, so that
 * machinery is either useless to them or actively in the way. (A consequence: an internal route
 * that accepts a body must parse it itself.)
 *
 * These routes have no application-level authentication. The authorization boundary is the
 * network: the app-server port must only be reachable via the Docker/private/Tailscale path
 * (public traffic terminates at nginx), with Tailscale ACLs restricting which nodes can reach it.
 * As defense in depth this middleware also rejects any request carrying `X-Forwarded-For` — the
 * same convention as `/metrics` — since nginx always appends that header while direct
 * private-network callers never send it. The header check alone is NOT an adequate boundary; it
 * only backstops the network placement.
 *
 * @param apis The API instances to mount; defaults to every registered `@internalApi`. Tests pass
 *   directly-constructed instances so they can supply fakes for the APIs' dependencies.
 */
export function internalRoutesMiddleware(apis?: ReadonlyArray<RegisteredApi>): Koa.Middleware {
  // The router is assembled on the first internal request rather than here: this middleware is
  // constructed while app.ts is still building the app, before the container registrations (the
  // HTTP and websocket servers) that the APIs' dependencies are constructed from. Resolving the
  // APIs at that point fails; by the time any request arrives, boot has completed.
  let router: { routes: Koa.Middleware; allowedMethods: Koa.Middleware } | undefined
  const getRouter = () => {
    if (!router) {
      const koaRouter = new KoaRouter()
      for (const api of apis ?? resolveAllInternalApis()) {
        applyApiRoutes(koaRouter, api)
      }
      router = {
        routes: koaRouter.routes() as Koa.Middleware,
        allowedMethods: koaRouter.allowedMethods() as Koa.Middleware,
      }
    }
    return router
  }

  return async (ctx, next) => {
    if (ctx.path !== INTERNAL_BASE_PATH && !ctx.path.startsWith(`${INTERNAL_BASE_PATH}/`)) {
      await next()
      return
    }

    // We only allow internal-route access through direct (tailscale/private-network) connections,
    // not the nginx forward; see the doc comment above.
    if ('x-forwarded-for' in ctx.headers) {
      ctx.throw(403, 'Forbidden')
    }

    // The outer `next` is deliberately never called: anything under the internal mount that
    // doesn't match a route 404s (or 405s via allowedMethods) here rather than falling through to
    // the public route stack.
    const { routes, allowedMethods } = getRouter()
    await routes(ctx, async () => allowedMethods(ctx, async () => {}))
  }
}
