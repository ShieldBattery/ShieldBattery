import Router, { RouterContext } from '@koa/router'
import { container, singleton } from 'tsyringe'
import { Class, Constructor } from 'type-fest'
import logger from '../logging/logger'
import { MetadataValue } from '../reflect/metadata'
import { routeMiddlewareMetadata, routesMetadata } from './route-decorators'

export const BASE_API_PATH = '/api/1'

/**
 * General type for handling HTTP requests that come to a particular base path. Extensions of this
 * type are intended to be injected into our base application, see `http-apis.ts` in the `server`
 * directory.
 *
 * Each implementation must be decorated with `@httpApi()` (see below) to be injected properly.
 */
export interface HttpApi {
  /**
   * Applies the middleware/routes for this API. The provided `Router` will be mounted under this
   * API's `basePath`.
   */
  applyRoutes(router: Router): void
}

/** Token used for injecting a list of every registered HTTP API. */
const API_INJECTION_TOKEN = Symbol('HttpApi')

interface HttpApiMetadata {
  basePath: string
}

/** Utility for setting/retrieving httpApi metadata. */
const httpApiMetadata = new MetadataValue<HttpApiMetadata, Constructor<HttpApi>>(
  Symbol('httpApiMetadata'),
)

/**
 * A class decorator that registers an `HttpApi` subclass for automatic configuration by the
 * application.
 *
 * This also implies `@singleton()` for the API class.
 *
 * @param basePath The path under which all routes for this API will be mounted. Leading and
 *    trailing slashes will be automatically normalized.
 */
export function httpApi<T extends HttpApi>(basePath: string) {
  return function (target: Class<T>): void {
    httpApiMetadata.set(target, { basePath })

    singleton()(target)
    container.register<HttpApi>(API_INJECTION_TOKEN, { useClass: target })
  }
}

export const classMiddlewareMetadata = new MetadataValue<Router.Middleware[], Constructor<HttpApi>>(
  Symbol('httpApiClassMiddleware'),
)

/**
 * Decorates a class to run the specified middleware functions before handling each request, for all
 * the routes contained within the class. This should be used alongside the `httpApi` decorator.
 *
 * Class middleware will run *before* any route-specific middleware, similar to calling
 * `router.use(...)` before specifying routes.
 */
export function httpBeforeAll<T extends HttpApi>(...middleware: Router.Middleware[]) {
  return function (target: Class<T>): void {
    classMiddlewareMetadata.set(target, middleware)
  }
}

/** Returns all the `HttpApi`s that have been registered for the application. */
export function resolveAllHttpApis(depContainer = container) {
  return depContainer.resolveAll<HttpApi>(API_INJECTION_TOKEN)
}

/**
 * Applies a given HttpApi's routes to the specified router. This should be used by code that is
 * initializing all the routes for the application.
 */
export function applyApiRoutes(router: Router, apiClass: HttpApi) {
  const metadata = httpApiMetadata.get(apiClass.constructor as Constructor<HttpApi>)
  const classMiddleware = classMiddlewareMetadata.get(apiClass.constructor as Constructor<HttpApi>)
  if (!metadata) {
    throw new Error(`Cannot apply routes to ${apiClass.constructor.name}, it has no metadata!`)
  }
  const routes = routesMetadata.get(apiClass.constructor.prototype)
  const middlewares = routeMiddlewareMetadata.get(apiClass.constructor.prototype)

  if (!routes.size) {
    logger.warn(`${apiClass.constructor.name} was registered as an httpApi but has no routes`)
  }
  for (const k of middlewares.keys()) {
    if (!routes.has(k)) {
      throw new Error(
        `${apiClass.constructor.name}#${String(k)} has middleware but was not ` +
          `registered as an API method`,
      )
    }
  }

  let subRouter = new Router()
  if (classMiddleware) {
    subRouter = subRouter.use(...classMiddleware)
  }

  for (const [k, r] of routes.entries()) {
    const middleware = middlewares.get(k) ?? []
    subRouter[r.method](r.path, ...middleware, async ctx => {
      const endpoint: (ctx: RouterContext) => any = (apiClass as any)[k]
      const result = await endpoint.apply(apiClass, [ctx])
      ctx.body = result
    })
  }

  // TODO(tec27): delete this once things are all moved over to the decorator approach
  apiClass.applyRoutes(subRouter)

  const apiPath = `${BASE_API_PATH}/${stripExtraSlashes(metadata.basePath)}`
  router.use(apiPath, subRouter.routes(), subRouter.allowedMethods())
  logger.info(`mounted ${apiClass.constructor.name} at ${apiPath}`)
}

function stripExtraSlashes(str: string) {
  return str.replace(/(^\/+|\/+$)/g, '')
}
