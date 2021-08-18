import Router, { RouterContext } from '@koa/router'
import { container, singleton } from 'tsyringe'
import { Class, Constructor } from 'type-fest'
import logger from '../logging/logger'
import { MetadataMapValue, MetadataValue } from '../reflect/metadata'

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
    container.register<HttpApi>(API_INJECTION_TOKEN, { useClass: target })
    const metadata: HttpApiMetadata = {
      basePath,
    }
    httpApiMetadata.set(target, metadata)

    singleton()(target)
  }
}

type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch'
type PropKey = string | symbol

interface RouteDefinition {
  method: HttpMethod
  path: string
}

const routesMetadata = new MetadataMapValue<PropKey, RouteDefinition, unknown>(
  Symbol('httpApiRoutes'),
)

type HttpApiMethod = (ctx: RouterContext) => any
type DecoratableHttpApi<K extends PropKey> = { [key in K]: HttpApiMethod }

function apiMethodDecorator(method: HttpMethod, path: string) {
  return function <K extends PropKey, T extends DecoratableHttpApi<K>>(target: T, propertyKey: K) {
    routesMetadata.setEntry(target, propertyKey, { method, path })
  }
}

/**
 * Decorates a method to handle a GET request for a particular path. The path will be appended to
 * its class's `basePath`. The method will also be automatically bound to the class instance.
 */
export function httpGet(path: string) {
  return apiMethodDecorator('get', path)
}

/**
 * Decorates a method to handle a POST request for a particular path. The path will be appended to
 * its class's `basePath`. The method will also be automatically bound to the class instance.
 */
export function httpPost(path: string) {
  return apiMethodDecorator('post', path)
}

/**
 * Decorates a method to handle a PUT request for a particular path. The path will be appended to
 * its class's `basePath`. The method will also be automatically bound to the class instance.
 */
export function httpPut(path: string) {
  return apiMethodDecorator('put', path)
}

/**
 * Decorates a method to handle a DELETE request for a particular path. The path will be appended to
 * its class's `basePath`. The method will also be automatically bound to the class instance.
 */
export function httpDelete(path: string) {
  return apiMethodDecorator('delete', path)
}

/**
 * Decorates a method to handle a PATCH request for a particular path. The path will be appended to
 * its class's `basePath`. The method will also be automatically bound to the class instance.
 */
export function httpPatch(path: string) {
  return apiMethodDecorator('patch', path)
}

const routeMiddlewareMetadata = new MetadataMapValue<PropKey, Router.Middleware[], unknown>(
  Symbol('httpApiRouteMiddleware'),
)

/**
 * Decorates a method to run the specified middleware functions before handling each request. This
 * should be used alongside one of the `http...` decorators, such as `httpGet` or `httpPost`.
 */
export function before(...middleware: Router.Middleware[]) {
  return function <K extends PropKey, T extends DecoratableHttpApi<K>>(target: T, propertyKey: K) {
    routeMiddlewareMetadata.setEntry(target, propertyKey, middleware)
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

  const subRouter = new Router()
  for (const [k, r] of routes.entries()) {
    const middleware = middlewares.get(k) ?? []
    subRouter[r.method](r.path, ...middleware, async ctx => {
      const endpoint: (ctx: RouterContext) => any = (apiClass as any)[k]
      const result = await endpoint(ctx)
      ctx.body = result
    })
  }

  apiClass.applyRoutes(subRouter)

  const apiPath = `${BASE_API_PATH}/${stripExtraSlashes(metadata.basePath)}`
  router.use(apiPath, subRouter.routes(), subRouter.allowedMethods())
  logger.info(`mounted ${apiClass.constructor.name} at ${apiPath}`)
}

function stripExtraSlashes(str: string) {
  return str.replace(/(^\/+|\/+$)/g, '')
}
