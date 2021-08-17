import Router from '@koa/router'
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
 * Registers an `HttpApi` subclass for automatic configuration by the application.
 *
 * @param basePath The path under which all routes for this API will be mounted. Leading and
 *    trailing slashes will be automatically normalized.
 */
export function httpApi<T extends HttpApi>(basePath: string): (target: Class<T>) => void {
  return function (target: Class<T>): void {
    container.register<HttpApi>(API_INJECTION_TOKEN, { useClass: target })
    const metadata: HttpApiMetadata = {
      basePath,
    }
    Reflect.defineMetadata(API_METADATA_KEY, metadata, target)
  }
}

/** Returns all the `HttpApi`s that have een registered for the application. */
export function resolveAllHttpApis(depContainer = container) {
  return depContainer.resolveAll<HttpApi>(API_INJECTION_TOKEN)
}

export function applyApiRoutes(router: Router, apiClass: HttpApi) {
  const metadata: HttpApiMetadata = Reflect.getOwnMetadata(API_METADATA_KEY, apiClass.constructor)
  if (!metadata) {
    throw new Error(`Cannot apply routes to ${apiClass.constructor.name}, it has no metadata!`)
  }

  const subRouter = new Router()
  apiClass.applyRoutes(subRouter)

  const apiPath = `${BASE_API_PATH}/${stripExtraSlashes(metadata.basePath)}`
  router.use(apiPath, subRouter.routes(), subRouter.allowedMethods())
  logger.info(`mounted ${apiClass.constructor.name} at ${apiPath}`)
}

function stripExtraSlashes(str: string) {
  return str.replace(/(^\/+|\/+$)/g, '')
}
