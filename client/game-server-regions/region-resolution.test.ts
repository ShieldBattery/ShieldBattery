import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  GameServerRegion,
  GameServerRegionLatencies,
  makeGameServerRegionId,
} from '../../common/game-server-regions'
import { TypedIpcRenderer } from '../../common/ipc'
import { jotaiStore } from '../jotai-store'
import {
  gameServerRegionsAtom,
  gameServerRegionsReadyAtom,
  manualGameServerRegionAtom,
} from './game-server-regions-atoms'
import {
  pickAutoRegion,
  resolveDesiredRegion,
  resolveManualRegion,
  resolveRegionSelection,
} from './region-resolution'

const REGION_US_EAST: GameServerRegion = {
  id: makeGameServerRegionId('us-east'),
  displayName: 'US East',
  beacon: 'beacon.us-east.example:1000',
  fallback: 'fallback.us-east.example:1000',
}

const REGION_EU_WEST: GameServerRegion = {
  id: makeGameServerRegionId('eu-west'),
  displayName: 'EU West',
  beacon: 'beacon.eu-west.example:1000',
  fallback: 'fallback.eu-west.example:1000',
}

const REGIONS = [REGION_US_EAST, REGION_EU_WEST]

function latencyFor(region: GameServerRegion, rttMs: number): GameServerRegionLatencies {
  return {
    [region.id]: { regionId: region.id, rttMs, source: 'beacon', measuredAt: Date.now() },
  }
}

describe('pickAutoRegion', () => {
  test('returns undefined for an empty table', () => {
    expect(pickAutoRegion(REGIONS, {})).toBeUndefined()
  })

  test('picks the lowest-rtt region', () => {
    const latencies = {
      ...latencyFor(REGION_US_EAST, 80),
      ...latencyFor(REGION_EU_WEST, 24),
    }

    expect(pickAutoRegion(REGIONS, latencies)).toEqual({
      region: REGION_EU_WEST.id,
      rttMs: 24,
      manual: false,
    })
  })

  test('a measurement for a region no longer in the list cannot win the pick', () => {
    // The app persists measurements across runs and serves them as stale hints until its first
    // sweep completes, so the table can name a region the operator has since retired -- even at a
    // better RTT than any current region.
    const retired: GameServerRegion = {
      id: makeGameServerRegionId('retired-region'),
      displayName: 'Retired',
      beacon: 'beacon.retired.example:1000',
      fallback: 'fallback.retired.example:1000',
    }
    const latencies = {
      ...latencyFor(retired, 5),
      ...latencyFor(REGION_EU_WEST, 24),
    }

    expect(pickAutoRegion(REGIONS, latencies)).toEqual({
      region: REGION_EU_WEST.id,
      rttMs: 24,
      manual: false,
    })
  })

  test('returns undefined when every measurement is for a retired region', () => {
    const retired: GameServerRegion = {
      id: makeGameServerRegionId('retired-region'),
      displayName: 'Retired',
      beacon: 'beacon.retired.example:1000',
      fallback: 'fallback.retired.example:1000',
    }

    expect(pickAutoRegion(REGIONS, latencyFor(retired, 5))).toBeUndefined()
  })
})

describe('resolveManualRegion', () => {
  test('returns undefined when no manual region is set', () => {
    expect(resolveManualRegion(undefined, REGIONS)).toBeUndefined()
  })

  test('returns undefined when the manual region is no longer in the list', () => {
    expect(resolveManualRegion(makeGameServerRegionId('removed-region'), REGIONS)).toBeUndefined()
  })

  test('returns the matching region when it is still in the list', () => {
    expect(resolveManualRegion(REGION_EU_WEST.id, REGIONS)).toEqual(REGION_EU_WEST)
  })
})

describe('resolveRegionSelection', () => {
  test('no setting: falls back to Auto', () => {
    const latencies = latencyFor(REGION_US_EAST, 24)

    expect(resolveRegionSelection(undefined, REGIONS, latencies)).toEqual({
      region: REGION_US_EAST.id,
      rttMs: 24,
      manual: false,
    })
  })

  test('manual-stale: a manual pick no longer in the region list falls back to Auto', () => {
    const latencies = latencyFor(REGION_US_EAST, 24)
    const staleRegionId = makeGameServerRegionId('decommissioned-region')

    // The pick reads as Auto: the setting named a region that no longer exists, so the region
    // reported is one the player never chose by hand.
    expect(resolveRegionSelection(staleRegionId, REGIONS, latencies)).toEqual({
      region: REGION_US_EAST.id,
      rttMs: 24,
      manual: false,
    })
  })

  test('manual valid: a manual pick still in the list wins over a lower-rtt region', () => {
    const latencies = {
      ...latencyFor(REGION_US_EAST, 80),
      ...latencyFor(REGION_EU_WEST, 24),
    }

    expect(resolveRegionSelection(REGION_US_EAST.id, REGIONS, latencies)).toEqual({
      region: REGION_US_EAST.id,
      rttMs: 80,
      manual: true,
    })
  })

  test('manual valid but unmeasured: resolves with a null rtt instead of falling back to Auto', () => {
    const latencies = latencyFor(REGION_EU_WEST, 24)

    expect(resolveRegionSelection(REGION_US_EAST.id, REGIONS, latencies)).toEqual({
      region: REGION_US_EAST.id,
      rttMs: null,
      manual: true,
    })
  })

  test('flags how the region was chosen: the settings pick is manual, the rtt pick is not', () => {
    const latencies = {
      ...latencyFor(REGION_US_EAST, 80),
      ...latencyFor(REGION_EU_WEST, 24),
    }

    expect(resolveRegionSelection(REGION_US_EAST.id, REGIONS, latencies)?.manual).toBe(true)
    expect(resolveRegionSelection(undefined, REGIONS, latencies)?.manual).toBe(false)
  })

  test('no setting and no measurements: resolves to undefined', () => {
    expect(resolveRegionSelection(undefined, REGIONS, {})).toBeUndefined()
  })
})

describe('resolveDesiredRegion', () => {
  afterEach(() => {
    jotaiStore.set(gameServerRegionsAtom, [])
    jotaiStore.set(gameServerRegionsReadyAtom, false)
    jotaiStore.set(manualGameServerRegionAtom, undefined)
    vi.restoreAllMocks()
  })

  test('settled empty region list: resolves to undefined immediately without touching the app', async () => {
    jotaiStore.set(gameServerRegionsAtom, [])
    jotaiStore.set(gameServerRegionsReadyAtom, true)
    const invokeSpy = vi.spyOn(TypedIpcRenderer.prototype, 'invoke')

    const result = await resolveDesiredRegion()

    expect(result).toBeUndefined()
    // No ensure-sweep kick, no latency poll -- there is nothing to measure.
    expect(invokeSpy).not.toHaveBeenCalled()
  })

  test('cold-cache empty list: polls, then uses the region list that arrives mid-window', async () => {
    // The server hands its initially-empty cache to early subscribers before the first
    // coordinator fetch completes; someone queueing in that window must not proceed regionless
    // when configured regions arrive moments later.
    jotaiStore.set(gameServerRegionsAtom, [])
    jotaiStore.set(gameServerRegionsReadyAtom, false)
    vi.spyOn(TypedIpcRenderer.prototype, 'invoke').mockImplementation(
      async (...[channel]: Parameters<typeof TypedIpcRenderer.prototype.invoke>) => {
        if (channel === 'gameServerRegionsGetLatencies') {
          return latencyFor(REGION_US_EAST, 24)
        }
        return undefined
      },
    )

    const resultPromise = resolveDesiredRegion()
    // The fetched list lands while the resolution is polling.
    setTimeout(() => {
      jotaiStore.set(gameServerRegionsAtom, REGIONS)
      jotaiStore.set(gameServerRegionsReadyAtom, true)
    }, 100)

    expect(await resultPromise).toEqual({ region: REGION_US_EAST.id, rttMs: 24, manual: false })
  })

  test('cold cache that settles empty mid-window: stops polling and resolves to undefined', async () => {
    jotaiStore.set(gameServerRegionsAtom, [])
    jotaiStore.set(gameServerRegionsReadyAtom, false)
    vi.spyOn(TypedIpcRenderer.prototype, 'invoke').mockResolvedValue(undefined)

    const resultPromise = resolveDesiredRegion()
    // The first fetch completes and confirms there are no regions (or it failed and the server
    // settled regionless) -- the resolution must stop waiting well before its own deadline.
    const start = performance.now()
    setTimeout(() => {
      jotaiStore.set(gameServerRegionsReadyAtom, true)
    }, 100)

    expect(await resultPromise).toBeUndefined()
    expect(performance.now() - start).toBeLessThan(3000)
  })

  test('non-empty region list with an immediate measurement: resolves without polling', async () => {
    jotaiStore.set(gameServerRegionsAtom, REGIONS)
    jotaiStore.set(gameServerRegionsReadyAtom, true)
    const invokeSpy = vi
      .spyOn(TypedIpcRenderer.prototype, 'invoke')
      .mockImplementation(
        async (...[channel]: Parameters<typeof TypedIpcRenderer.prototype.invoke>) => {
          if (channel === 'gameServerRegionsGetLatencies') {
            return latencyFor(REGION_US_EAST, 24)
          }
          return undefined
        },
      )

    const result = await resolveDesiredRegion()

    expect(result).toEqual({ region: REGION_US_EAST.id, rttMs: 24, manual: false })
    expect(invokeSpy).toHaveBeenCalledTimes(1)
    expect(invokeSpy).toHaveBeenCalledWith('gameServerRegionsGetLatencies')
  })

  test('non-empty region list with no measurement yet: kicks the sweep and polls until one lands', async () => {
    jotaiStore.set(gameServerRegionsAtom, REGIONS)
    jotaiStore.set(gameServerRegionsReadyAtom, true)
    let getLatenciesCalls = 0
    const invokeSpy = vi
      .spyOn(TypedIpcRenderer.prototype, 'invoke')
      .mockImplementation(
        async (...[channel]: Parameters<typeof TypedIpcRenderer.prototype.invoke>) => {
          if (channel === 'gameServerRegionsGetLatencies') {
            getLatenciesCalls += 1
            return getLatenciesCalls === 1 ? {} : latencyFor(REGION_EU_WEST, 40)
          }
          if (channel === 'gameServerRegionsEnsureSweep') {
            return undefined
          }
          return undefined
        },
      )

    const result = await resolveDesiredRegion()

    expect(result).toEqual({ region: REGION_EU_WEST.id, rttMs: 40, manual: false })
    expect(invokeSpy).toHaveBeenCalledWith('gameServerRegionsEnsureSweep')
    expect(getLatenciesCalls).toBeGreaterThanOrEqual(2)
  })
})
