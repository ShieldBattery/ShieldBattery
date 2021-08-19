import Router, { RouterContext } from '@koa/router'
import { container, singleton } from 'tsyringe'
import { Class, Constructor } from 'type-fest'
import logger from '../logging/logger'
import { MetadataValue } from '../reflect/metadata'
import { routeMiddlewareMetadata, routesMetadata } from './route-decorators'

export const BASE_API_PATH = '/api/1'

/** Token used for injecting a list of every registered HTTP API. */
const API_INJECTION_TOKEN = Symbol('HttpApi')

interface HttpApiMetadata {
  basePath: string
}

/** Utility for setting/retrieving httpApi metadata. */
const httpApiMetadata = new MetadataValue<HttpApiMetadata, Constructor<unknown>>(
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
export function httpApi<T>(basePath: string) {
  return function (target: Class<T>): void {
    httpApiMetadata.set(target, { basePath })

    singleton()(target)
    container.register(API_INJECTION_TOKEN, { useClass: target })
  }
}

export const classMiddlewareMetadata = new MetadataValue<Router.Middleware[], Constructor<unknown>>(
  Symbol('httpApiClassMiddleware'),
)

/**
 * Decorates a class to run the specified middleware functions before handling each request, for all
 * the routes contained within the class. This should be used alongside the `httpApi` decorator.
 *
 * Class middleware will run *before* any route-specific middleware, similar to calling
 * `router.use(...)` before specifying routes.
 */
export function httpBeforeAll<T>(...middleware: Router.Middleware[]) {
  return function (target: Class<T>): void {
    classMiddlewareMetadata.set(target, middleware)
  }
}

/** Returns all the HTTP API classes that have been registered for the application. */
export function resolveAllHttpApis(depContainer = container) {
  return depContainer.resolveAll<{ constructor: Constructor<unknown> }>(API_INJECTION_TOKEN)
}

/**
 * Applies a given HttpApi's routes to the specified router. This should be used by code that is
 * initializing all the routes for the application.
 */
export function applyApiRoutes<T extends { constructor: Constructor<unknown> }>(
  router: Router,
  apiClass: T,
) {
  const metadata = httpApiMetadata.get(apiClass.constructor)
  const classMiddleware = classMiddlewareMetadata.get(apiClass.constructor)
  if (!metadata) {
    // NOTE(tec27): If this happens then something has gone horribly wrong, good luck! :)
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

  const apiPath = `${BASE_API_PATH}/${stripExtraSlashes(metadata.basePath)}`
  router.use(apiPath, subRouter.routes(), subRouter.allowedMethods())
  logger.info(`mounted ${apiClass.constructor.name} at ${apiPath}`)
}

function stripExtraSlashes(str: string) {
  return str.replace(/(^\/+|\/+$)/g, '')
}
