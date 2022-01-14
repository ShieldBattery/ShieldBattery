import httpErrors from 'http-errors'
import { ExtendableContext, Middleware, Next } from 'koa'
import { PromiseBasedThrottle } from './create-throttle'

// Env var that lets us turn throttling off for testing
const THROTTLING_DISABLED = Boolean(process.env.SB_DISABLE_THROTTLING ?? false)

async function middlewareFunc(
  throttle: PromiseBasedThrottle,
  getId: (ctx: ExtendableContext) => string,
  ctx: ExtendableContext,
  next: Next,
) {
  const isLimited = await throttle.rateLimit(getId(ctx))
  // NOTE(tec27): We still check the throttle even if it's disabled just to make sure we exercise
  // as much code as possible
  if (isLimited && !THROTTLING_DISABLED) {
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
