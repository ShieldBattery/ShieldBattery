import httpErrors from 'http-errors'
import { ExtendableContext, Middleware, Next } from 'koa'
import { TokenBucketThrottle } from './create-throttle'

/**
 * Throttle identifier for endpoints that require a logged-in user (i.e. sit behind
 * `ensureLoggedIn`): buckets are per-user. Throws if there is no session, so don't use it on
 * public endpoints.
 */
export function throttleByUser(ctx: ExtendableContext): string {
  return String(ctx.session!.user.id)
}

/**
 * Throttle identifier for public endpoints: buckets are per-user when logged in, falling back to
 * per-IP for anonymous requests.
 */
export function throttleByUserOrIp(ctx: ExtendableContext): string {
  return String(ctx.session?.user?.id ?? ctx.ip)
}

/**
 * Throttle identifier that is always the client IP, even for logged-in users. For operations
 * where switching accounts shouldn't grant a fresh bucket (e.g. account creation, password
 * recovery).
 */
export function throttleByIp(ctx: ExtendableContext): string {
  return String(ctx.ip)
}

// Env var that lets us turn throttling off for testing
const THROTTLING_DISABLED = Boolean(process.env.SB_DISABLE_THROTTLING ?? false)

export async function throttleMiddlewareFunc(
  throttle: TokenBucketThrottle,
  getId: (ctx: ExtendableContext) => string,
  ctx: ExtendableContext,
  next: Next,
) {
  const { limited, waitMs } = await throttle.rateLimitWithWait(getId(ctx))
  // NOTE(tec27): We still check the throttle even if it's disabled just to make sure we exercise
  // as much code as possible
  if (limited && !THROTTLING_DISABLED) {
    ctx.set('Retry-After', String(Math.ceil(waitMs / 1000)))
    throw new httpErrors.TooManyRequests()
  } else {
    await next()
  }
}

// Creates a new middleware function that will enforce request throttling using the specified
// throttle object (see ./create-throttle) and ID-retrieval method (which is a function(ctx)).
export default function throttleMiddleware(
  throttle: TokenBucketThrottle,
  getId: (ctx: ExtendableContext) => string,
): Middleware {
  return (ctx: ExtendableContext, next: Next) => throttleMiddlewareFunc(throttle, getId, ctx, next)
}
