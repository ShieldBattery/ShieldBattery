import { singleton } from 'tsyringe'
import swallowNonBuiltins from '../../../common/async/swallow-non-builtins'
import { NewsEvent, NewsPostChangeEvent, UrgentMessageChangeEvent } from '../../../common/news'
import { UrgentMessage } from '../../../common/typeshare'
import logger from '../logging/logger'
import { Redis, RedisSubscriber } from '../redis/redis'
import { Clock, TimeoutId } from '../time/clock'
import { UserSocketsManager } from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'
import { getLatestPublishedNewsPost, getNextScheduledNewsPostTime } from './news-post-models'

const REDIS_KEY = 'news:urgentMessage'

const URGENT_MESSAGE_PATH = '/news'
const NEWS_POSTS_PATH = '/newsPosts'

// `setTimeout` stores its delay in a 32-bit signed int; anything larger overflows and fires
// immediately. We clamp to this and re-arm each time it elapses until the real time arrives.
const MAX_TIMEOUT_MS = 2 ** 31 - 1
// A small amount of extra time to wait past a scheduled post's publish time before re-querying, so
// that the post is reliably visible as published (and we don't busy-loop re-arming right at the
// boundary).
const SCHEDULED_PUBLISH_SLOP_MS = 1000
// How long to wait before retrying after a reconcile pass fails (e.g. a transient DB error), so
// scheduled publishing recovers without needing another post mutation.
const RECONCILE_RETRY_MS = 60 * 1000

interface LatestNewsPost {
  id: string
  publishedAt: number
}

function toUrgentMessageEvent(message?: UrgentMessage): UrgentMessageChangeEvent {
  return message
    ? {
        type: 'urgentMessageChange',
        id: message.id,
        publishedAt: new Date(message.publishedAt).getTime(),
      }
    : {
        type: 'urgentMessageChange',
      }
}

function toNewsPostEvent(post?: LatestNewsPost): NewsPostChangeEvent {
  return post
    ? {
        type: 'newsPostChange',
        id: post.id,
        publishedAt: post.publishedAt,
      }
    : {
        type: 'newsPostChange',
      }
}

@singleton()
export class NewsService {
  private urgentMessageCache: Promise<UrgentMessage | undefined>
  private latestNewsPost: LatestNewsPost | undefined
  // Holds the most recent reconcile pass so newly-connected users seed off up-to-date state.
  // NOTE: this promise is infallible.
  private latestNewsPostReconcile: Promise<void>
  private scheduledPublishTimer: TimeoutId | undefined
  private scheduledPublishGeneration = 0

  constructor(
    private redis: Redis,
    private redisSubscriber: RedisSubscriber,
    private publisher: TypedPublisher<NewsEvent>,
    private userSocketsManager: UserSocketsManager,
    private clock: Clock,
  ) {
    this.urgentMessageCache = Promise.resolve().then(() => this.getUrgentMessage())
    this.latestNewsPostReconcile = this.reconcileLatestNewsPost()

    this.redisSubscriber
      .subscribe('news', message => {
        switch (message.type) {
          case 'urgentMessageChanged':
            this.urgentMessageCache = Promise.resolve().then(() => this.getUrgentMessage())
            // NOTE(tec27): this promise is infallible
            this.urgentMessageCache
              .then(message => {
                this.publisher.publish(URGENT_MESSAGE_PATH, toUrgentMessageEvent(message))
              })
              .catch(swallowNonBuiltins)
            break
          case 'newsPostsChanged':
            this.queueLatestNewsPostReconcile()
            break
        }
      })
      .catch(err => {
        logger.error({ err }, 'failed to subscribe to Redis news messages')
      })

    this.userSocketsManager.on('newUser', u => {
      u.subscribe<NewsEvent>(URGENT_MESSAGE_PATH, async () => {
        // NOTE(tec27): this promise is infallible
        const message = await this.urgentMessageCache
        return toUrgentMessageEvent(message)
      })
      u.subscribe<NewsEvent>(NEWS_POSTS_PATH, async () => {
        await this.latestNewsPostReconcile
        return toNewsPostEvent(this.latestNewsPost)
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

  /**
   * Chains a reconcile pass after any already-running one. Reconciles read the DB and then update
   * cached state, so two overlapping passes could otherwise complete out of order and leave stale
   * state cached (and published) until the next change.
   */
  private queueLatestNewsPostReconcile(): void {
    this.latestNewsPostReconcile = this.latestNewsPostReconcile.then(() =>
      this.reconcileLatestNewsPost(),
    )
  }

  private async reconcileLatestNewsPost(): Promise<void> {
    let latest: LatestNewsPost | undefined
    try {
      const post = await getLatestPublishedNewsPost()
      latest = post ? { id: post.id, publishedAt: Number(post.publishedAt) } : undefined
    } catch (err) {
      logger.error({ err }, 'failed to retrieve the latest published news post')
      // A transient DB error must not stall scheduled publishing — the timer that may have
      // triggered this reconcile has already been cleared — so retry on a delay.
      this.armReconcileTimer(this.takeTimerGeneration(), RECONCILE_RETRY_MS)
      return
    }

    const current = this.latestNewsPost
    if (current?.id !== latest?.id || current?.publishedAt !== latest?.publishedAt) {
      this.latestNewsPost = latest
      try {
        this.publisher.publish(NEWS_POSTS_PATH, toNewsPostEvent(latest))
      } catch (err) {
        // A publish failure must not reject this pass — the reconcile promise is chained and
        // awaited on the assumption that it never rejects.
        logger.error({ err }, 'failed to publish news post change')
      }
    }

    await this.armScheduledPublishTimer()
  }

  /**
   * Invalidates any pending reconcile timer and returns the generation a replacement timer should
   * be armed under.
   */
  private takeTimerGeneration(): number {
    const generation = ++this.scheduledPublishGeneration
    if (this.scheduledPublishTimer !== undefined) {
      this.clock.clearTimeout(this.scheduledPublishTimer)
      this.scheduledPublishTimer = undefined
    }
    return generation
  }

  /** Arms a timer that queues a reconcile pass after `delay`, unless `generation` is stale. */
  private armReconcileTimer(generation: number, delay: number): void {
    if (generation !== this.scheduledPublishGeneration) {
      return
    }
    this.scheduledPublishTimer = this.clock.setTimeout(() => {
      if (generation !== this.scheduledPublishGeneration) {
        return
      }
      this.scheduledPublishTimer = undefined
      this.queueLatestNewsPostReconcile()
    }, delay)
  }

  private async armScheduledPublishTimer(): Promise<void> {
    const generation = this.takeTimerGeneration()

    let nextTime: Date | undefined
    try {
      nextTime = await getNextScheduledNewsPostTime()
    } catch (err) {
      logger.error({ err }, 'failed to retrieve the next scheduled news post time')
      this.armReconcileTimer(generation, RECONCILE_RETRY_MS)
      return
    }

    if (generation !== this.scheduledPublishGeneration || nextTime === undefined) {
      // Another reconcile pass superseded us, or nothing is scheduled.
      return
    }

    const delay = Math.min(
      Math.max(Number(nextTime) - this.clock.now() + SCHEDULED_PUBLISH_SLOP_MS, 0),
      MAX_TIMEOUT_MS,
    )
    this.armReconcileTimer(generation, delay)
  }
}
