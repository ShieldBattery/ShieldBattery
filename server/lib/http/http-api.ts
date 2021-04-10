import Router from '@koa/router'
import { container } from 'tsyringe'
import { Class } from 'type-fest'
import logger from '../logging/logger'

/**
 * General type for handling HTTP requests that come to a particular base path. Extensions of this
 * type are intended to be injected into our base application, see `http-apis.ts` in the `server`
 * directory.
 *
 * Each implementation must be decorated with `@httpApi()` (see below) to be injected properly.
 */
export abstract class HttpApi {
  static readonly BASE_API_PATH = '/api/1'

  /**
   * Constructs a new HttpApi mounted at the given path.
   *
   * @param basePath The path under which all routes for this API will be mounted.
   */
  constructor(readonly basePath: string) {}

  /**
   * Applies this APIs routes to the given router. This should be called by the application to
   * do Router initialization. Child classes should not override this method.
   */
  applyToRouter(router: Router): void {
    const subRouter = new Router()
    this.applyRoutes(subRouter)

    const apiPath = `${HttpApi.BASE_API_PATH}/${stripExtraSlashes(this.basePath)}`
    router.use(apiPath, subRouter.routes(), subRouter.allowedMethods())
    logger.info(`mounted ${this.constructor.name} at ${apiPath}`)
  }

  /**
   * Applies the middleware/routes for this API. The provided `Router` will be mounted under this
   * API's `basePath`.
   */
  protected abstract applyRoutes(router: Router): void
}

const API_INJECTION_TOKEN = 'HttpApi'

/** Registers an `HttpApi` subclass for automatic configuration by the application. */
export function httpApi<T extends HttpApi>(): (target: Class<T>) => void {
  return function (target: Class<T>): void {
    container.register<HttpApi>(API_INJECTION_TOKEN, { useClass: target })
  }
}

/** Returns all the `HttpApi`s that have een registered for the application. */
export function resolveAllHttpApis(depContainer = container) {
  return depContainer.resolveAll<HttpApi>(API_INJECTION_TOKEN)
}

function stripExtraSlashes(str: string) {
  return str.replace(/(^\/|\/$)/g, '')
}
