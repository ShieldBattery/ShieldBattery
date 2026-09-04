import Router, { RouterContext, RouterMiddleware } from '@koa/router'
import { container, singleton } from 'tsyringe'
import { Class, Constructor } from 'type-fest'
import logger from '../logging/logger'
import { MetadataValue } from '../reflect/metadata'
import { routeMiddlewareMetadata, routesMetadata } from './route-decorators'

/** Mount point for the public (browser/game client) HTTP APIs, registered with `@httpApi`. */
export const BASE_API_PATH = '/api/1'
/**
 * Mount point for the service-to-service HTTP APIs, registered with `@internalApi`. Reachable only
 * over the private network/tailnet; see internal-routes.ts for the access boundary.
 */
export const INTERNAL_BASE_PATH = '/internal'

/** Token used for injecting a list of every registered public HTTP API. */
const API_INJECTION_TOKEN = Symbol('HttpApi')
/** Token used for injecting a list of every registered internal HTTP API. */
const INTERNAL_API_INJECTION_TOKEN = Symbol('InternalApi')

interface HttpApiMetadata {
  /** The full path the API's routes are mounted under, e.g. `/api/1/games`. */
  mountPath: string
}

/** Utility for setting/retrieving httpApi metadata. */
const httpApiMetadata = new MetadataValue<HttpApiMetadata, Constructor<unknown>>(
  Symbol('httpApiMetadata'),
)

function registerApi<T>(
  target: Class<T>,
  injectionToken: symbol,
  rootPath: string,
  basePath: string,
) {
  httpApiMetadata.set(target, { mountPath: `${rootPath}/${stripExtraSlashes(basePath)}` })

  singleton()(target)
  container.register(injectionToken, { useClass: target })
}

/**
 * A class decorator that registers an `HttpApi` subclass for automatic configuration by the
 * application, mounted under `BASE_API_PATH`.
 *
 * This also implies `@singleton()` for the API class.
 *
 * @param basePath The path under which all routes for this API will be mounted. Leading and
 *    trailing slashes will be automatically normalized.
 */
export function httpApi<T>(basePath: string) {
  return function (target: Class<T>): void {
    registerApi(target, API_INJECTION_TOKEN, BASE_API_PATH, basePath)
  }
}

/**
 * A class decorator that registers an API class for service-to-service callers, mounted under
 * `INTERNAL_BASE_PATH`. Routes are declared with the same method decorators as `@httpApi` classes
 * (`@httpGet`, `@httpBefore`, ...), but the mount is separate: internal APIs run ahead of the
 * browser-oriented middleware chain and rely on network placement rather than sessions for
 * authorization. See internal-routes.ts.
 *
 * This also implies `@singleton()` for the API class.
 */
export function internalApi<T>(basePath: string) {
  return function (target: Class<T>): void {
    registerApi(target, INTERNAL_API_INJECTION_TOKEN, INTERNAL_BASE_PATH, basePath)
  }
}

export const classMiddlewareMetadata = new MetadataValue<RouterMiddleware[], Constructor<unknown>>(
  Symbol('httpApiClassMiddleware'),
)

/**
 * Decorates a class to run the specified middleware functions before handling each request, for all
 * the routes contained within the class. This should be used alongside the `httpApi` decorator.
 *
 * Class middleware will run *before* any route-specific middleware, similar to calling
 * `router.use(...)` before specifying routes.
 */
export function httpBeforeAll<T>(...middleware: RouterMiddleware[]) {
  return function (target: Class<T>): void {
    classMiddlewareMetadata.set(target, middleware)
  }
}

/** An instance of an API class registered with `@httpApi` or `@internalApi`. */
export type RegisteredApi = object

/** Returns all the public HTTP API classes that have been registered for the application. */
export function resolveAllHttpApis(depContainer = container) {
  return depContainer.resolveAll<RegisteredApi>(API_INJECTION_TOKEN)
}

/** Returns all the internal HTTP API classes that have been registered for the application. */
export function resolveAllInternalApis(depContainer = container) {
  return depContainer.resolveAll<RegisteredApi>(INTERNAL_API_INJECTION_TOKEN)
}

/**
 * Applies a given HttpApi's routes to the specified router. This should be used by code that is
 * initializing all the routes for the application.
 */
export function applyApiRoutes<T extends RegisteredApi>(router: Router, apiClass: T) {
  const ctor = apiClass.constructor as Constructor<unknown>
  const metadata = httpApiMetadata.get(ctor)
  const classMiddleware = classMiddlewareMetadata.get(ctor)
  if (!metadata) {
    // NOTE(tec27): If this happens then something has gone horribly wrong, good luck! :)
    throw new Error(`Cannot apply routes to ${ctor.name}, it has no metadata!`)
  }
  const routes = routesMetadata.get(ctor.prototype)
  const middlewares = routeMiddlewareMetadata.get(ctor.prototype)

  if (!routes.size) {
    logger.warn(`${ctor.name} was registered as an API but has no routes`)
  }
  for (const k of middlewares.keys()) {
    if (!routes.has(k)) {
      throw new Error(
        `${ctor.name}#${String(k)} has middleware but was not registered as an API method`,
      )
    }
  }

  const subRouter = new Router()
  if (classMiddleware) {
    subRouter.use(...classMiddleware)
  }

  for (const [k, r] of routes.entries()) {
    const middleware = middlewares.get(k) ?? []
    subRouter[r.method](r.path, ...middleware, async ctx => {
      const endpoint: (ctx: RouterContext) => any = (apiClass as any)[k]
      const result = await endpoint.apply(apiClass, [ctx])
      ctx.body = result
    })
  }

  router.use(metadata.mountPath, subRouter.routes(), subRouter.allowedMethods())
  logger.info(`mounted ${ctor.name} at ${metadata.mountPath}`)
}

function stripExtraSlashes(str: string) {
  return str.replace(/(^\/+|\/+$)/g, '')
}
