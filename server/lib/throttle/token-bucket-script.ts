import { CommandParser, defineScript } from '@redis/client'

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
const TOKEN_BUCKET_LUA = `
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

/**
 * Runs `TOKEN_BUCKET_LUA` against the bucket at `key`. Registered on the shared Redis client as
 * `sbThrottle`, which sends it by SHA and falls back to the full script if Redis hasn't cached it.
 */
export const TOKEN_BUCKET_SCRIPT = defineScript({
  SCRIPT: TOKEN_BUCKET_LUA,
  NUMBER_OF_KEYS: 1,
  parseCommand(
    parser: CommandParser,
    key: string,
    rate: number,
    burst: number,
    windowMs: number,
    expirySecs: number,
  ) {
    parser.pushKey(key)
    parser.push(String(rate), String(burst), String(windowMs), String(expirySecs))
  },
  transformReply: (reply: [limited: number, waitMs: number]) => reply,
})
