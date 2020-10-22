import { Redis } from 'ioredis'
import tokenthrottle, { Throttle } from 'tokenthrottle'
import { RedisTable, RedisTableOptions } from 'tokenthrottle-redis'
import redisClient from '../redis'

export class PromiseBasedThrottle {
  readonly _throttle: Throttle

  constructor(throttle: Throttle) {
    this._throttle = throttle
  }

  // Returns a promise that resolves to a boolean value saying whether or not the client
  // identified by `id` is currently rate-limited. Rejects on backing store errors.
  rateLimit(id: string) {
    return new Promise<boolean>((resolve, reject) => {
      this._throttle.rateLimit(id, (err, limited) => {
        if (err) {
          reject(err)
        } else {
          resolve(limited)
        }
      })
    })
  }
}

// A slight modification of tokenthrottle-redis's table class to deal with the fact that ioredis
// returns an object instance when a key doesn't exist (instead of returning a falsey value)
class IoredisTable extends RedisTable {
  constructor(redisClient: Redis, options: RedisTableOptions) {
    super(redisClient, options)
  }

  get(key: string, cb: (err: Error | null | undefined, obj?: unknown) => void) {
    super.get(key, (err, result) => {
      if (err) {
        cb(err)
      } else if (result && (result as any).window) {
        cb(null, result)
      } else {
        cb(null, null)
      }
    })
  }
}

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
  const table = new IoredisTable(redisClient, {
    prefix: 'sbthrottle:' + name,
    expiry:
      opts.expiry ||
      Math.round(((opts.window || 1000) * 10 * ((opts.burst || opts.rate) / opts.rate)) / 1000),
  })

  return new PromiseBasedThrottle(
    tokenthrottle({
      ...opts,
      tokensTable: table,
    }),
  )
}
