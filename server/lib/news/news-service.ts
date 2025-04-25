import { singleton } from 'tsyringe'
import swallowNonBuiltins from '../../../common/async/swallow-non-builtins'
import { NewsEvent } from '../../../common/news'
import { UrgentMessage } from '../../../common/typeshare'
import logger from '../logging/logger'
import { Redis, RedisSubscriber } from '../redis/redis'
import { UserSocketsManager } from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'

const REDIS_KEY = 'news:urgentMessage'

@singleton()
export class NewsService {
  private urgentMessageCache: Promise<UrgentMessage | undefined>

  constructor(
    private redis: Redis,
    private redisSubscriber: RedisSubscriber,
    private publisher: TypedPublisher<NewsEvent>,
    private userSocketsManager: UserSocketsManager,
  ) {
    this.urgentMessageCache = Promise.resolve().then(() => this.getUrgentMessage())

    this.redisSubscriber
      .subscribe('news', message => {
        switch (message.type) {
          case 'urgentMessageChanged':
            this.urgentMessageCache = Promise.resolve().then(() => this.getUrgentMessage())
            // NOTE(tec27): this promise is infallible
            this.urgentMessageCache
              .then(message => {
                this.publisher.publish('/news', {
                  type: 'urgentMessageChange',
                  publishedAt: message ? new Date(message.publishedAt).getTime() : undefined,
                })
              })
              .catch(swallowNonBuiltins)
            break
        }
      })
      .catch(err => {
        logger.error({ err }, 'failed to subscribe to Redis news messages')
      })

    this.userSocketsManager.on('newUser', u => {
      u.subscribe<NewsEvent>('/news', async () => {
        // NOTE(tec27): this promise is infallible
        const message = await this.urgentMessageCache
        return {
          type: 'urgentMessageChange',
          publishedAt: message ? new Date(message.publishedAt).getTime() : undefined,
        }
      })
    })
  }

  async getUrgentMessage(): Promise<UrgentMessage | undefined> {
    try {
      const message = await this.redis.get(REDIS_KEY)
      if (message) {
        return JSON.parse(message)
      }
    } catch (err) {
      logger.error({ err }, 'failed to retrieve latest urgent message from Redis')
    }

    return undefined
  }
}
