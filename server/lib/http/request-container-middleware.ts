import { RouterContext } from '@koa/router'
import { Next } from 'koa'
import { container } from 'tsyringe'
import { registerForRequest } from './injection'

/**
 * Middleware that creates a tsyringe child container specific to an HTTP request. This allows us
 * to inject dependencies specific to the request and keep `@scoped(Lifecycle.ContainerScoped)` to
 * the lifetime of the request.
 */
export function requestContainerCreator() {
  return async (ctx: RouterContext, next: Next) => {
    ctx.container = container.createChildContainer()
    registerForRequest(ctx)

    return next()
  }
}
