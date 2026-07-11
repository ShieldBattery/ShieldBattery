import got from 'got'
import { EventEmitter } from 'node:events'
import { NydusServer } from 'nydus'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { asMockedFunction } from '../../../common/testing/mocks'
import { FakeClock } from '../time/testing/fake-clock'
import { ClientSocketsGroup, ClientSocketsManager } from '../websockets/socket-groups'
import { GameServerRegionsService } from './game-server-regions-service'

vi.mock('got', () => ({
  default: {
    get: vi.fn(),
  },
}))

const CACHE_TTL_MS = 10 * 60 * 1000
const RETRY_BACKOFF_MS = 30 * 1000

/** Stubs netcode v2 as configured, the precondition `loadConfigFromEnv` requires to be enabled. */
function configureCoordinator() {
  vi.stubEnv('SB_RP2_COORDINATOR_URL', 'http://coordinator.example')
  vi.stubEnv('SB_RP2_TENANT', 'sb-dev')
  vi.stubEnv('SB_RP2_CLIENT_KEY', '11'.repeat(32))
}

/** A `GET /regions` response body entry, in the coordinator's snake_case wire shape. */
function wireRegion(id: string, displayName: string, suffix: string) {
  return {
    id,
    // eslint-disable-next-line camelcase
    display_name: displayName,
    beacon: `beacon-${suffix}`,
    fallback: `fallback-${suffix}`,
  }
}

/** Queues one resolved `got.get(...).json()` response. */
function mockCoordinatorRegionsOnce(regions: unknown[]) {
  const json = vi.fn().mockResolvedValue({ regions })
  asMockedFunction(got.get).mockReturnValueOnce({ json } as any)
}

/** Queues one `got.get(...).json()` call that never resolves, to hold a fetch open. */
function mockCoordinatorPendingOnce(): { resolve: (regions: unknown[]) => void } {
  let resolveFn: (v: unknown) => void = () => {}
  const json = vi.fn().mockReturnValue(
    new Promise(resolve => {
      resolveFn = resolve
    }),
  )
  asMockedFunction(got.get).mockReturnValueOnce({ json } as any)
  return { resolve: regions => resolveFn({ regions }) }
}

class FakeClientSocketsManager extends EventEmitter {}

describe('game-server-regions/GameServerRegionsService', () => {
  let nydus: { publish: ReturnType<typeof vi.fn> }
  let clientSocketsManager: FakeClientSocketsManager
  let clock: FakeClock

  beforeEach(() => {
    nydus = { publish: vi.fn() }
    clientSocketsManager = new FakeClientSocketsManager()
    clock = new FakeClock()
    clock.setCurrentTime(1_000_000)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  function makeService(): GameServerRegionsService {
    return new GameServerRegionsService(
      nydus as unknown as NydusServer,
      clientSocketsManager as unknown as ClientSocketsManager,
      clock,
    )
  }

  function connectElectronClient(): { subscribe: ReturnType<typeof vi.fn> } {
    const subscribe = vi.fn()
    const client = { clientType: 'electron', subscribe } as unknown as ClientSocketsGroup
    clientSocketsManager.emit('newClient', client)
    return { subscribe }
  }

  test('stays dormant, never calling the coordinator, when netcode v2 is not configured', async () => {
    const service = makeService()

    await expect(service.getRegions()).resolves.toEqual([])
    expect(got.get).not.toHaveBeenCalled()

    const { subscribe } = connectElectronClient()
    expect(subscribe.mock.calls[0][1]()).toEqual({ type: 'fullUpdate', regions: [] })
    expect(got.get).not.toHaveBeenCalled()
  })

  test('does not subscribe a non-electron (web) client', () => {
    makeService()

    const subscribe = vi.fn()
    const client = { clientType: 'web', subscribe } as unknown as ClientSocketsGroup
    clientSocketsManager.emit('newClient', client)

    expect(subscribe).not.toHaveBeenCalled()
  })

  test('getRegions() awaits and returns the translated list on the first-ever fetch', async () => {
    configureCoordinator()
    mockCoordinatorRegionsOnce([wireRegion('us-east', 'US East', 'a')])
    const service = makeService()

    const regions = await service.getRegions()

    expect(got.get).toHaveBeenCalledWith('http://coordinator.example/regions', {
      timeout: { request: 10000 },
    })
    expect(regions).toEqual([
      { id: 'us-east', displayName: 'US East', beacon: 'beacon-a', fallback: 'fallback-a' },
    ])
  })

  test('a subscription returns the cache immediately without blocking on the coordinator, then a fullUpdate publish catches it up', async () => {
    configureCoordinator()
    const pending = mockCoordinatorPendingOnce()
    makeService()

    const { subscribe } = connectElectronClient()

    // The demand kicked a fetch, but the subscribe call itself never waited on it.
    expect(subscribe.mock.calls[0][1]()).toEqual({ type: 'fullUpdate', regions: [] })
    expect(nydus.publish).not.toHaveBeenCalled()

    pending.resolve([wireRegion('us-east', 'US East', 'a')])

    await vi.waitFor(() => {
      expect(nydus.publish).toHaveBeenCalledWith('/gameServerRegions', {
        type: 'fullUpdate',
        regions: [
          { id: 'us-east', displayName: 'US East', beacon: 'beacon-a', fallback: 'fallback-a' },
        ],
      })
    })
  })

  test('concurrent demand shares a single in-flight fetch', async () => {
    configureCoordinator()
    const pending = mockCoordinatorPendingOnce()
    const service = makeService()

    const p1 = service.getRegions()
    const p2 = service.getRegions()
    pending.resolve([wireRegion('us-east', 'US East', 'a')])
    const [r1, r2] = await Promise.all([p1, p2])

    expect(got.get).toHaveBeenCalledTimes(1)
    expect(r1).toEqual(r2)
  })

  test('a demand after the cache TTL elapses re-fetches in the background while still serving the current cache', async () => {
    configureCoordinator()
    mockCoordinatorRegionsOnce([wireRegion('us-east', 'US East', 'a')])
    const service = makeService()
    await service.getRegions()
    expect(got.get).toHaveBeenCalledTimes(1)

    clock.setCurrentTime(clock.monotonicNow() + CACHE_TTL_MS)
    const pending = mockCoordinatorPendingOnce()

    const stale = await service.getRegions()

    // Served immediately from cache, not blocked on the newly-triggered re-fetch.
    expect(stale).toEqual([
      { id: 'us-east', displayName: 'US East', beacon: 'beacon-a', fallback: 'fallback-a' },
    ])
    expect(got.get).toHaveBeenCalledTimes(2)

    pending.resolve([wireRegion('us-west', 'US West', 'b')])
    await vi.waitFor(() => {
      expect(nydus.publish).toHaveBeenCalledWith('/gameServerRegions', {
        type: 'fullUpdate',
        regions: [
          { id: 'us-west', displayName: 'US West', beacon: 'beacon-b', fallback: 'fallback-b' },
        ],
      })
    })
  })

  test('a demand before the cache TTL elapses does not re-fetch', async () => {
    configureCoordinator()
    mockCoordinatorRegionsOnce([wireRegion('us-east', 'US East', 'a')])
    const service = makeService()
    await service.getRegions()
    expect(got.get).toHaveBeenCalledTimes(1)

    clock.setCurrentTime(clock.monotonicNow() + CACHE_TTL_MS - 1)
    await service.getRegions()

    expect(got.get).toHaveBeenCalledTimes(1)
  })

  test('a failed fetch keeps serving the last good (empty) list and gates the next attempt behind a backoff', async () => {
    configureCoordinator()
    asMockedFunction(got.get).mockImplementation(() => {
      throw new Error('coordinator down')
    })
    const service = makeService()

    await expect(service.getRegions()).resolves.toEqual([])
    expect(got.get).toHaveBeenCalledTimes(1)

    // Still within the backoff window: no second coordinator call.
    await expect(service.getRegions()).resolves.toEqual([])
    expect(got.get).toHaveBeenCalledTimes(1)

    clock.setCurrentTime(clock.monotonicNow() + RETRY_BACKOFF_MS)
    await service.getRegions()
    expect(got.get).toHaveBeenCalledTimes(2)
  })

  test('a failed refresh after a prior success keeps serving the last good (non-empty) list', async () => {
    configureCoordinator()
    mockCoordinatorRegionsOnce([wireRegion('us-east', 'US East', 'a')])
    const service = makeService()
    await service.getRegions()

    clock.setCurrentTime(clock.monotonicNow() + CACHE_TTL_MS)
    asMockedFunction(got.get).mockImplementation(() => {
      throw new Error('coordinator down')
    })
    await service.getRegions()

    await vi.waitFor(() => {
      expect(got.get).toHaveBeenCalledTimes(2)
    })
    expect(await service.getRegions()).toEqual([
      { id: 'us-east', displayName: 'US East', beacon: 'beacon-a', fallback: 'fallback-a' },
    ])
    // The failure did not re-publish (nothing changed).
    expect(nydus.publish).toHaveBeenCalledTimes(1)
  })
})
