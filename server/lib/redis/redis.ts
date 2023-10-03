import IoRedis from 'ioredis'
import { singleton } from 'tsyringe'
import { appendToMultimap } from '../../../common/data-structures/maps'
import { PublishedMessage } from '../../../common/typeshare'
import logger from '../logging/logger'

// TODO(tec27): provide some better wrapper around this that deals with connects/disconnects, etc.
@singleton()
export class Redis extends IoRedis {
  constructor() {
    super({
      port: Number(process.env.SB_REDIS_PORT),
      host: process.env.SB_REDIS_HOST,
    })
  }
}

export type SubscriptionHandler<T> = (message: T) => void
export type PatternSubscriptionHandler<T> = (pattern: string, channel: string, message: T) => void

/**
 * A redis client for use in subscribing to pub/sub messages. All messages are assumed to be
 * JSON-encoded to reduce processing overhead.
 */
@singleton()
export class RedisSubscriber {
  private redis: IoRedis
  private subscriptions = new Map<string, SubscriptionHandler<unknown>[]>()
  private patternSubscriptions = new Map<string, PatternSubscriptionHandler<unknown>[]>()

  constructor() {
    this.redis = new IoRedis({
      port: Number(process.env.SB_REDIS_PORT),
      host: process.env.SB_REDIS_HOST,
    })

    this.redis
      .on('message', (channel, message) => {
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
      })
      .on('pmessage', (pattern, channel, message) => {
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
      })
  }

  async subscribe<C extends PublishedMessage['type'], T extends PublishedMessage & { type: C }>(
    channel: C,
    handler: SubscriptionHandler<T['data']>,
  ): Promise<void> {
    if (!this.subscriptions.has(channel)) {
      await this.redis.subscribe(channel)
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
      await this.redis.unsubscribe(channel)
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
    if (!this.patternSubscriptions.has(pattern)) {
      await this.redis.psubscribe(pattern)
    }

    appendToMultimap(this.patternSubscriptions, pattern, handler)
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
      await this.redis.punsubscribe(pattern)
      this.patternSubscriptions.delete(pattern)
    } else {
      handlers.splice(index, 1)
    }
  }
}
