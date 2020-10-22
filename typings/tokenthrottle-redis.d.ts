declare module 'tokenthrottle-redis' {
  import { TokensTable } from 'tokenthrottle'

  interface RedisTableOptions {
    /** Number of seconds after which untouched tokens will be expired. Default: no expiry */
    expiry?: number
    /** An optional string to prefix throttle keys with in redis. Default: `"redisThrottle"` */
    prefix?: string
  }

  export class RedisTable implements TokensTable {
    constructor(redisClient: unknown, options: RedisTableOptions)

    put(key: string, object: unknown, cb: (err?: Error) => void): void
    get(key: string, cb: (err: Error | null | undefined, obj?: unknown) => void): void
  }
}
