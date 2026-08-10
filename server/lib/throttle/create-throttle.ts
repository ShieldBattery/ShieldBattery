import { container } from 'tsyringe'
import { Redis } from '../redis/redis'

/**
 * Lua implementation of a token-bucket rate limit check, run entirely inside Redis so that
 * checking and updating the bucket is a single atomic operation (concurrent requests can never
 * consume more than `burst` tokens between them) and costs one round trip.
 *
 * Bucket state is a hash of `tokens` (possibly fractional) and `time` (last update, unix ms).
 * Tokens refill continuously at `rate` per `window` up to a maximum of `burst`.
 *
 * Time comes from Redis's own clock (`TIME`), not the caller's: with a caller-supplied clock, two
 * processes whose clocks disagree by more than one token interval could ping-pong the stored
 * timestamp and re-credit the skew interval on every alternation, refilling the bucket almost
 * immediately. A single shared clock makes that impossible.
 *
 * KEYS[1]: bucket key
 * ARGV[1]: rate (tokens refilled per window)
 * ARGV[2]: burst (maximum bucket capacity)
 * ARGV[3]: window (milliseconds)
 * ARGV[4]: key expiry (seconds)
 *
 * Returns `{limited, waitMs}` where `limited` is 1 if the request should be rejected, and
 * `waitMs` is how long until a token will be available (0 when not limited).
 *
 * NOTE: server-rs is expected to mirror this script exactly if/when it gains rate limiting, so
 * that both servers can share bucket state and semantics. If you change the script or the key
 * layout, change it there too.
 */
export const TOKEN_BUCKET_LUA = `
  local rate = tonumber(ARGV[1])
  local burst = tonumber(ARGV[2])
  local window = tonumber(ARGV[3])

  local t = redis.call('TIME')
  local now = t[1] * 1000 + math.floor(t[2] / 1000)

  local bucket = redis.call('HMGET', KEYS[1], 'tokens', 'time')
  local tokens = tonumber(bucket[1])
  local time = tonumber(bucket[2])
  if tokens == nil or time == nil then
    tokens = burst
    time = now
  end
  -- Guard against the Redis host's clock stepping backwards
  if now < time then
    time = now
  end
  tokens = math.min(burst, tokens + (now - time) * (rate / window))

  local limited = 0
  local waitMs = 0
  if tokens >= 1 then
    tokens = tokens - 1
  else
    limited = 1
    waitMs = math.ceil((1 - tokens) * (window / rate))
  end

  redis.call('HSET', KEYS[1], 'tokens', tokens, 'time', now)
  redis.call('EXPIRE', KEYS[1], ARGV[4])
  return {limited, waitMs}
`

interface ThrottleRedis extends Redis {
  /** Custom command registered via `defineCommand`, running `TOKEN_BUCKET_LUA`. */
  sbThrottle(
    key: string,
    rate: number,
    burst: number,
    windowMs: number,
    expirySecs: number,
  ): Promise<[limited: number, waitMs: number]>
}

function getThrottleRedis(): ThrottleRedis {
  const redis = container.resolve(Redis) as ThrottleRedis
  if (typeof redis.sbThrottle !== 'function') {
    redis.defineCommand('sbThrottle', { numberOfKeys: 1, lua: TOKEN_BUCKET_LUA })
  }
  return redis
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
    const [limited, waitMs] = await getThrottleRedis().sbThrottle(
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
