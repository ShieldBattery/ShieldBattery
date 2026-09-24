import { createClient } from '@redis/client'
import { singleton } from 'tsyringe'
import { appendToMultimap } from '../../../common/data-structures/maps'
import { PublishedMessage } from '../../../common/typeshare'
import logger from '../logging/logger'
import { TOKEN_BUCKET_SCRIPT } from '../throttle/token-bucket-script'

/**
 * Delay before each reconnection attempt: doubling from 50ms up to a 2s cap, plus up to 200ms of
 * jitter. Attempts never stop, since these clients live as long as the process does and nothing
 * else would ever re-create them; commands issued while disconnected wait in the client's queue
 * (up to their command timeout) and pub/sub subscriptions are re-established on every reconnect.
 */
function reconnectDelay(retries: number): number {
  return Math.min(2 ** retries * 50, 2000) + Math.floor(Math.random() * 200)
}

function createRedisClient(name: string) {
  const client = createClient({
    socket: {
      host: process.env.SB_REDIS_HOST,
      port: Number(process.env.SB_REDIS_PORT),
      reconnectStrategy: reconnectDelay,
    },
    // Pinned rather than left to the library default so that reply shapes (e.g. strings and arrays
    // vs. RESP3's doubles and maps) can't change underneath the code using them.
    RESP: 2,
    scripts: {
      sbThrottle: TOKEN_BUCKET_SCRIPT,
    },
  })
  // An 'error' event with no listener would crash the process. These are mostly connection
  // failures, which the reconnect strategy already recovers from.
  client.on('error', err => {
    logger.error({ err, client: name }, 'redis error')
  })

  return client
}

export type RedisClient = ReturnType<typeof createRedisClient>

/**
 * Starts connecting `client`, returning a promise that resolves once its first connection is ready.
 * This only rejects if the client is closed before then, as connection failures are retried
 * indefinitely.
 */
async function connectRedisClient(client: RedisClient): Promise<void> {
  await client.connect()
}

/**
 * The shared Redis connection for issuing commands. It begins connecting as soon as it is
 * constructed, so callers (including other constructors) can issue commands immediately: they are
 * queued until the connection is ready, subject to the client's command timeout.
 */
@singleton()
export class Redis {
  readonly client = createRedisClient('command')
  /** Resolves once the first connection to Redis is ready. */
  readonly connected = connectRedisClient(this.client)
}

export type SubscriptionHandler<T> = (message: T) => void
export type PatternSubscriptionHandler<T> = (pattern: string, channel: string, message: T) => void

/**
 * A redis client for use in subscribing to pub/sub messages. All messages are assumed to be
 * JSON-encoded to reduce processing overhead.
 */
@singleton()
export class RedisSubscriber {
  // Subscribing switches a connection into a mode where it can't issue other commands, so this
  // needs its own client
  private client = createRedisClient('subscriber')
  /** Resolves once the first connection to Redis is ready. */
  readonly connected = connectRedisClient(this.client)

  private subscriptions = new Map<string, SubscriptionHandler<unknown>[]>()
  private patternSubscriptions = new Map<string, PatternSubscriptionHandler<unknown>[]>()

  // Registered as the listener for every channel, so node-redis never ends up with more than one
  // listener for a channel even if subscriptions to it race
  private onMessage = (message: string, channel: string) => {
    const handlers = this.subscriptions.get(channel)
    if (handlers) {
      let parsed: unknown
      try {
        parsed = JSON.parse(message)
      } catch (err) {
        logger.error({ err }, `failed to parse Redis published message to '${channel}'`)
        return
      }

      if (!parsed || (parsed as any).type !== channel) {
        logger.error(
          `received a Redis published message with mismatched type and channel: ` +
            `channel='${channel}', type='${(parsed as any)?.type}'`,
        )
      }

      const inner = (parsed as PublishedMessage).data

      for (const handler of handlers) {
        try {
          handler(inner)
        } catch (err) {
          logger.error({ err }, `failed to handle Redis published message to '${channel}'`)
        }
      }
    } else {
      logger.warn(`received a Redis published message with no handlers: '${channel}'`)
    }
  }

  private onPatternMessage(pattern: string, channel: string, message: string) {
    const handlers = this.patternSubscriptions.get(pattern)
    if (handlers) {
      let parsed: unknown
      try {
        parsed = JSON.parse(message)
      } catch (err) {
        logger.error(
          { err },
          `failed to parse Redis published message to pattern: '${pattern}' -- '${channel}'`,
        )
        return
      }

      for (const handler of handlers) {
        try {
          handler(pattern, channel, parsed)
        } catch (err) {
          logger.error(
            { err },
            `failed to handle Redis published message to pattern: '${pattern}' -- '${channel}'`,
          )
        }
      }
    } else {
      logger.warn(
        `received a Redis published message with no handlers for ` +
          `pattern: '${pattern}' -- '${channel}'`,
      )
    }
  }

  async subscribe<C extends PublishedMessage['type'], T extends PublishedMessage & { type: C }>(
    channel: C,
    handler: SubscriptionHandler<T['data']>,
  ): Promise<void> {
    if (!this.subscriptions.has(channel)) {
      await this.client.subscribe(channel, this.onMessage)
    }

    appendToMultimap(this.subscriptions, channel, handler)
  }

  async unsubscribe<T extends PublishedMessage>(
    channel: string,
    handler: SubscriptionHandler<T['data']>,
  ): Promise<void> {
    const handlers = this.subscriptions.get(channel)
    if (!handlers) {
      throw new Error('handler was not subscribed')
    }

    const index = handlers.indexOf(handler as any)
    if (index === -1) {
      throw new Error('handler was not subscribed')
    }

    if (handlers.length === 1) {
      await this.client.unsubscribe(channel)
      this.subscriptions.delete(channel)
    } else {
      handlers.splice(index, 1)
    }
  }

  // TODO(tec27): If we use pattern subscribe, we'll need to figure out a good way of picking the
  // right internal type for the messages (split on / or : or something?)
  async psubscribe<T extends PublishedMessage>(
    pattern: string,
    handler: PatternSubscriptionHandler<T>,
  ): Promise<void> {
    const handlers = this.patternSubscriptions.get(pattern)
    if (handlers) {
      handlers.push(handler as PatternSubscriptionHandler<unknown>)
      return
    }

    // node-redis doesn't tell pattern listeners which pattern matched, so each pattern gets its
    // own listener. The handler list is registered before subscribing so that a racing
    // `psubscribe` for the same pattern joins it rather than adding a second listener (which would
    // deliver every message twice).
    this.patternSubscriptions.set(pattern, [handler as PatternSubscriptionHandler<unknown>])
    try {
      await this.client.pSubscribe(pattern, (message, channel) =>
        this.onPatternMessage(pattern, channel, message),
      )
    } catch (err) {
      this.patternSubscriptions.delete(pattern)
      throw err
    }
  }

  async punsubscribe<T extends PublishedMessage>(
    pattern: string,
    handler: PatternSubscriptionHandler<T>,
  ): Promise<void> {
    const handlers = this.patternSubscriptions.get(pattern)
    if (!handlers) {
      throw new Error('handler was not subscribed')
    }

    const index = handlers.indexOf(handler as any)
    if (index === -1) {
      throw new Error('handler was not subscribed')
    }

    if (handlers.length === 1) {
      await this.client.pUnsubscribe(pattern)
      this.patternSubscriptions.delete(pattern)
    } else {
      handlers.splice(index, 1)
    }
  }
}
