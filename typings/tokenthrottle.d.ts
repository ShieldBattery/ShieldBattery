declare module 'tokenthrottle' {
  interface TokensTable {
    put(key: string, object: unknown, cb: (err?: Error) => void): void
    get(key: string, cb: (err: Error | null | undefined, obj?: unknown) => void): void
  }

  interface BaseThrottleOptions {
    /** How many tokens to replenish per `window` */
    rate: number
    /** The maximum number of actions allowed per `window`. Default: `rate` */
    burst?: number
    /** The milliseconds in which `rate` and `burst` act. Default: `1000` */
    window?: number
  }

  interface ThrottleOverrides {
    [key: string]: BaseThrottleOptions
  }

  interface ThrottleOptions extends BaseThrottleOptions {
    /** A custom table implementation to use for storing token info */
    tokensTable?: TokensTable
    /** A dictionary of overrides to apply when throttling particular ids */
    overrides?: ThrottleOverrides
  }

  interface Throttle {
    /**
     * Attempt to get a token for `id`, returning whether this id is currently limited via an
     * async callback.
     */
    rateLimit(id: string, cb: (err: Error | null, limited: boolean) => void): void
  }

  export default function (options: ThrottleOptions): Throttle
}
