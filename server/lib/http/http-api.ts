import Router, { RouterContext } from '@koa/router'
import { container } from 'tsyringe'
import { Class } from 'type-fest'
import logger from '../logging/logger'

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

/** Key used to store metadata about the HTTP API, such as where it should be mounted. */
const API_METADATA_KEY = Symbol('httpApiMeta')

interface HttpApiMetadata {
  basePath: string
}

/**
 * A class decorator that registers an `HttpApi` subclass for automatic configuration by the
 * application.
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
    Reflect.defineMetadata(API_METADATA_KEY, metadata, target)
  }
}

const ROUTES_METADATA_KEY = Symbol('httpApiRoutes')

type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch'
type PropKey = string | symbol

interface RouteDefinition {
  method: HttpMethod
  path: string
}

type HttpApiMethod = (ctx: RouterContext) => any
// NOTE(tec27): We disable this because the Reflect types want Object, and the alternatives don't
// suffice here
// eslint-disable-next-line @typescript-eslint/ban-types
type DecoratableHttpApi<K extends PropKey> = { [key in K]: HttpApiMethod } & Object

export function apiMethodDecorator(method: HttpMethod, path: string) {
  return function <K extends PropKey, T extends DecoratableHttpApi<K>>(target: T, propertyKey: K) {
    const routes: Map<PropKey, RouteDefinition> =
      Reflect.getOwnMetadata(ROUTES_METADATA_KEY, target) ?? new Map()
    routes.set(propertyKey, { method, path })
    Reflect.defineMetadata(ROUTES_METADATA_KEY, routes, target)
  }
}

/**
 * A method decorator that binds a method to handle a GET request for a particular path. The path
 * will be appended to its class's `basePath`. The method will also be automatically bound to the
 * class instance.
 */
export function httpGet(path: string) {
  return apiMethodDecorator('get', path)
}

/**
 * A method decorator that binds a method to handle a POST request for a particular path. The path
 * will be appended to its class's `basePath`. The method will also be automatically bound to the
 * class instance.
 */
export function httpPost(path: string) {
  return apiMethodDecorator('post', path)
}

/**
 * A method decorator that binds a method to handle a PUT request for a particular path. The path
 * will be appended to its class's `basePath`. The method will also be automatically bound to the
 * class instance.
 */
export function httpPut(path: string) {
  return apiMethodDecorator('put', path)
}

/**
 * A method decorator that binds a method to handle a DELETE request for a particular path. The path
 * will be appended to its class's `basePath`. The method will also be automatically bound to the
 * class instance.
 */
export function httpDelete(path: string) {
  return apiMethodDecorator('delete', path)
}

/**
 * A method decorator that binds a method to handle a PATCH request for a particular path. The path
 * will be appended to its class's `basePath`. The method will also be automatically bound to the
 * class instance.
 */
export function httpPatch(path: string) {
  return apiMethodDecorator('patch', path)
}

const MIDDLEWARE_METADATA_KEY = Symbol('httpApiMiddleware')

export function withMiddleware(...middleware: Router.Middleware[]) {
  return function <K extends PropKey, T extends DecoratableHttpApi<K>>(target: T, propertyKey: K) {
    const registrations: Map<PropKey, Router.Middleware[]> =
      Reflect.getOwnMetadata(MIDDLEWARE_METADATA_KEY, target) ?? new Map()
    registrations.set(propertyKey, middleware)
    Reflect.defineMetadata(MIDDLEWARE_METADATA_KEY, registrations, target)
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
  const metadata: HttpApiMetadata = Reflect.getOwnMetadata(API_METADATA_KEY, apiClass.constructor)
  if (!metadata) {
    throw new Error(`Cannot apply routes to ${apiClass.constructor.name}, it has no metadata!`)
  }
  const routes: Map<PropKey, RouteDefinition> =
    Reflect.getOwnMetadata(ROUTES_METADATA_KEY, apiClass.constructor.prototype) ?? new Map()
  const middlewares: Map<PropKey, Router.Middleware[]> =
    Reflect.getOwnMetadata(MIDDLEWARE_METADATA_KEY, apiClass.constructor.prototype) ?? new Map()

  if (!routes.size) {
    logger.warn(`${apiClass.constructor.name} was registered as an httpApi but has no routes`)
  }
  for (const k of middlewares.keys()) {
    if (!routes.has(k)) {
      logger.warn(
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
