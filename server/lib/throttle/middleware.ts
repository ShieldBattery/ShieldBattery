import httpErrors from 'http-errors'
import { ExtendableContext, Middleware, Next } from 'koa'
import { PromiseBasedThrottle } from './create-throttle'

async function middlewareFunc(
  throttle: PromiseBasedThrottle,
  getId: (ctx: ExtendableContext) => string,
  ctx: ExtendableContext,
  next: Next,
) {
  const isLimited = await throttle.rateLimit(getId(ctx))
  if (isLimited) {
    throw new httpErrors.TooManyRequests()
  } else {
    await next()
  }
}

// Creates a new middleware function that will enforce request throttling using the specified
// throttle object (see ./create-throttle) and ID-retrieval method (which is a function(ctx)).
export default function throttleMiddleware(
  throttle: PromiseBasedThrottle,
  getId: (ctx: ExtendableContext) => string,
): Middleware {
  return (ctx: ExtendableContext, next: Next) => middlewareFunc(throttle, getId, ctx, next)
}
