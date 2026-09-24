import { container } from 'tsyringe'
import { Redis } from '../redis/redis'

export interface CreateThrottleOptions {
  /** The number of milliseconds in which `rate` and `burst` act */
  window: number
  /** How many tokens are refreshed every `window` amount of time */
  rate: number
  /** The maximum number of requests allowed in a `window` amount of time */
  burst: number
  /**
   * How long the token bucket keys in redis should be set to expire for, in seconds
   *    (default: 10 * (`burst` / `rate`) `window`s)
   */
  expiry?: number
}

/** A Redis-backed token-bucket rate limiter for a single logical operation. */
export class TokenBucketThrottle {
  constructor(
    private readonly keyPrefix: string,
    private readonly opts: Required<CreateThrottleOptions>,
  ) {}

  /**
   * Returns whether the client identified by `id` is currently rate-limited, consuming a token
   * from its bucket if not. Rejects on backing store errors.
   */
  async rateLimit(id: string): Promise<boolean> {
    const { limited } = await this.rateLimitWithWait(id)
    return limited
  }

  /**
   * Like `rateLimit`, but also returns how many milliseconds until a token will be available
   * (0 when not limited), e.g. for populating a Retry-After header.
   */
  async rateLimitWithWait(id: string): Promise<{ limited: boolean; waitMs: number }> {
    const { rate, burst, window, expiry } = this.opts
    const { client } = container.resolve(Redis)
    const [limited, waitMs] = await client.sbThrottle(
      `${this.keyPrefix}~${id}`,
      rate,
      burst,
      window,
      expiry,
    )
    return { limited: limited === 1, waitMs }
  }
}

/**
 * Creates a new throttle object using the specified options and our usual redis client. The `name`
 * is used in the redis key.
 *
 * Options are:
 *  - window: the number of milliseconds in which `rate` and `burst` act
 *  - rate: how many tokens are refreshed every `window` amount of time
 *  - burst: maximum number of requests allowed in a `window` amount of time
 *  - expiry: how long the token bucket keys in redis should be set to expire for, in seconds
 *    (default: 10 * (`burst` / `rate`) `window`s)
 */
export default function createThrottle(name: string, opts: CreateThrottleOptions) {
  return new TokenBucketThrottle('sbthrottle:' + name, {
    ...opts,
    expiry:
      opts.expiry ??
      Math.round((opts.window * 10 * ((opts.burst || opts.rate) / opts.rate)) / 1000),
  })
}
