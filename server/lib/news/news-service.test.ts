import { NydusServer } from 'nydus'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NewsEvent } from '../../../common/news'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { Redis, RedisSubscriber } from '../redis/redis'
import { FakeClock, StopCriteria } from '../time/testing/fake-clock'
import { RequestSessionLookup } from '../websockets/session-lookup'
import { UserSocketsManager } from '../websockets/socket-groups'
import {
  clearTestLogs,
  createFakeNydusServer,
  InspectableNydusClient,
  NydusConnector,
} from '../websockets/testing/websockets'
import { TypedPublisher } from '../websockets/typed-publisher'
import { getLatestPublishedNewsPost, getNextScheduledNewsPostTime } from './news-post-models'
import { NewsService } from './news-service'

const MAX_TIMEOUT_MS = 2 ** 31 - 1

interface TestPost {
  id: string
  publishedAt: number
}

interface NewsTestState {
  now: () => number
  posts: TestPost[]
}

vi.mock('./news-post-models', () => ({
  getLatestPublishedNewsPost: vi.fn(async () => {
    const state = (global as any).__NEWS_TEST as NewsTestState
    const now = state.now()
    const published = state.posts.filter(p => p.publishedAt <= now)
    if (published.length === 0) {
      return undefined
    }
    published.sort((a, b) => b.publishedAt - a.publishedAt || (a.id < b.id ? 1 : -1))
    const top = published[0]
    return { id: top.id, publishedAt: new Date(top.publishedAt) }
  }),
  getNextScheduledNewsPostTime: vi.fn(async () => {
    const state = (global as any).__NEWS_TEST as NewsTestState
    const now = state.now()
    const future = state.posts.filter(p => p.publishedAt > now).map(p => p.publishedAt)
    if (future.length === 0) {
      return undefined
    }
    return new Date(Math.min(...future))
  }),
}))

const getLatestPublishedNewsPostMock = asMockedFunction(getLatestPublishedNewsPost)
const getNextScheduledNewsPostTimeMock = asMockedFunction(getNextScheduledNewsPostTime)

class FakeRedisSubscriber {
  private handlers = new Map<string, Array<(message: any) => void>>()

  subscribe = vi.fn(async (channel: string, handler: (message: any) => void) => {
    const existing = this.handlers.get(channel) ?? []
    existing.push(handler)
    this.handlers.set(channel, existing)
  })

  emit(channel: string, message: any) {
    for (const handler of this.handlers.get(channel) ?? []) {
      handler(message)
    }
  }
}

const NEWS_POSTS_PATH = '/newsPosts'
const BASE_TIME = Number(new Date('2024-01-01T00:00:00.000Z'))

async function flush() {
  await new Promise(resolve => setImmediate(resolve))
}

describe('news/news-service', () => {
  let clock: FakeClock
  let nydus: NydusServer
  let publisher: TypedPublisher<NewsEvent>
  let userSocketsManager: UserSocketsManager
  let connector: NydusConnector
  let redisSubscriber: FakeRedisSubscriber
  let service: NewsService
  let testState: NewsTestState

  let client1: InspectableNydusClient

  async function emitNewsPostsChanged() {
    redisSubscriber.emit('news', { type: 'newsPostsChanged', data: undefined })
    await (service as any).latestNewsPostReconcile
  }

  async function runNextTimer() {
    await clock.runTimeoutsUntil({ criteria: StopCriteria.NumTasks, numTasks: 1 })
    await (service as any).latestNewsPostReconcile
    await flush()
  }

  beforeEach(async () => {
    clock = new FakeClock()
    clock.autoRunTimeouts = false
    clock.setCurrentTime(BASE_TIME)

    testState = { now: () => clock.now(), posts: [] }
    ;(global as any).__NEWS_TEST = testState

    getLatestPublishedNewsPostMock.mockClear()
    getNextScheduledNewsPostTimeMock.mockClear()

    nydus = createFakeNydusServer()
    const sessionLookup = new RequestSessionLookup()
    userSocketsManager = new UserSocketsManager(nydus, sessionLookup, async () => {})
    publisher = new TypedPublisher(nydus)
    redisSubscriber = new FakeRedisSubscriber()
    const redis = { get: vi.fn(async () => null) } as unknown as Redis

    service = new NewsService(
      redis,
      redisSubscriber as unknown as RedisSubscriber,
      publisher,
      userSocketsManager,
      clock,
    )
    await (service as any).latestNewsPostReconcile

    connector = new NydusConnector(nydus, sessionLookup)
    client1 = connector.connectClient(
      { id: makeSbUserId(1), name: 'One', created: 1577836800000 },
      'one',
    )
    await flush()

    asMockedFunction(client1.publish).mockClear()
    clearTestLogs(nydus)
  })

  test('publishes and seeds when a post becomes the latest published one', async () => {
    testState.posts.push({ id: 'p1', publishedAt: BASE_TIME - 1000 })

    await emitNewsPostsChanged()

    expect(client1.publish).toHaveBeenCalledWith(NEWS_POSTS_PATH, {
      type: 'newsPostChange',
      id: 'p1',
      publishedAt: BASE_TIME - 1000,
    })

    // A user connecting afterwards should be seeded with the current latest post.
    const client2 = connector.connectClient(
      { id: makeSbUserId(2), name: 'Two', created: 1577836800000 },
      'two',
    )
    await flush()

    expect(client2.publish).toHaveBeenCalledWith(NEWS_POSTS_PATH, {
      type: 'newsPostChange',
      id: 'p1',
      publishedAt: BASE_TIME - 1000,
    })
  })

  test('does not publish again when nothing has changed', async () => {
    testState.posts.push({ id: 'p1', publishedAt: BASE_TIME - 1000 })
    await emitNewsPostsChanged()
    asMockedFunction(client1.publish).mockClear()

    await emitNewsPostsChanged()

    expect(client1.publish).not.toHaveBeenCalled()
  })

  test('publishes the cleared variant when everything is unpublished', async () => {
    testState.posts.push({ id: 'p1', publishedAt: BASE_TIME - 1000 })
    await emitNewsPostsChanged()
    asMockedFunction(client1.publish).mockClear()

    testState.posts = []
    await emitNewsPostsChanged()

    expect(client1.publish).toHaveBeenCalledWith(NEWS_POSTS_PATH, {
      type: 'newsPostChange',
    })
  })

  test('fires the event when a scheduled post reaches its publish time', async () => {
    testState.posts.push({ id: 'p1', publishedAt: BASE_TIME + 1000 })
    await emitNewsPostsChanged()

    // Not published yet, so nothing has been broadcast.
    expect(client1.publish).not.toHaveBeenCalledWith(NEWS_POSTS_PATH, expect.anything())

    await runNextTimer()

    expect(client1.publish).toHaveBeenCalledWith(NEWS_POSTS_PATH, {
      type: 'newsPostChange',
      id: 'p1',
      publishedAt: BASE_TIME + 1000,
    })
  })

  test('re-arms the timer for the next scheduled post', async () => {
    testState.posts.push({ id: 'p1', publishedAt: BASE_TIME + 1000 })
    testState.posts.push({ id: 'p2', publishedAt: BASE_TIME + 6000 })
    await emitNewsPostsChanged()

    await runNextTimer()
    expect(client1.publish).toHaveBeenCalledWith(NEWS_POSTS_PATH, {
      type: 'newsPostChange',
      id: 'p1',
      publishedAt: BASE_TIME + 1000,
    })
    asMockedFunction(client1.publish).mockClear()

    await runNextTimer()
    expect(client1.publish).toHaveBeenCalledWith(NEWS_POSTS_PATH, {
      type: 'newsPostChange',
      id: 'p2',
      publishedAt: BASE_TIME + 6000,
    })
  })

  test('retries after a transient DB error instead of stalling scheduled publishing', async () => {
    testState.posts.push({ id: 'p1', publishedAt: BASE_TIME + 1000 })
    await emitNewsPostsChanged()

    // The reconcile triggered by the scheduled-publish timer fails (the timer is already cleared
    // at this point, so without a retry the signal would never fire)...
    getLatestPublishedNewsPostMock.mockRejectedValueOnce(new Error('db went away'))
    await runNextTimer()
    expect(client1.publish).not.toHaveBeenCalledWith(NEWS_POSTS_PATH, expect.anything())

    // ...but a retry timer was armed, and the next pass publishes the event.
    await runNextTimer()
    expect(client1.publish).toHaveBeenCalledWith(NEWS_POSTS_PATH, {
      type: 'newsPostChange',
      id: 'p1',
      publishedAt: BASE_TIME + 1000,
    })
  })

  test('clamps and re-arms for a post scheduled beyond the max timeout', async () => {
    const publishedAt = BASE_TIME + MAX_TIMEOUT_MS + 10000
    testState.posts.push({ id: 'p1', publishedAt })
    await emitNewsPostsChanged()

    // First tick only advances by the clamped max, so the post still isn't live.
    await runNextTimer()
    expect(client1.publish).not.toHaveBeenCalledWith(NEWS_POSTS_PATH, expect.anything())

    // Second tick reaches the publish time.
    await runNextTimer()
    expect(client1.publish).toHaveBeenCalledWith(NEWS_POSTS_PATH, {
      type: 'newsPostChange',
      id: 'p1',
      publishedAt,
    })
  })
})
