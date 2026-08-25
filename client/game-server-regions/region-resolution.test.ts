import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  GameServerRegion,
  GameServerRegionLatencies,
  makeGameServerRegionId,
} from '../../common/game-server-regions'
import { TypedIpcRenderer } from '../../common/ipc'
import { jotaiStore } from '../jotai-store'
import { gameServerRegionsAtom, manualGameServerRegionAtom } from './game-server-regions-atoms'
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
    expect(pickAutoRegion({})).toBeUndefined()
  })

  test('picks the lowest-rtt region', () => {
    const latencies = {
      ...latencyFor(REGION_US_EAST, 80),
      ...latencyFor(REGION_EU_WEST, 24),
    }

    expect(pickAutoRegion(latencies)).toEqual({ region: REGION_EU_WEST.id, rttMs: 24 })
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
    })
  })

  test('manual-stale: a manual pick no longer in the region list falls back to Auto', () => {
    const latencies = latencyFor(REGION_US_EAST, 24)
    const staleRegionId = makeGameServerRegionId('decommissioned-region')

    expect(resolveRegionSelection(staleRegionId, REGIONS, latencies)).toEqual({
      region: REGION_US_EAST.id,
      rttMs: 24,
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
    })
  })

  test('manual valid but unmeasured: resolves with a null rtt instead of falling back to Auto', () => {
    const latencies = latencyFor(REGION_EU_WEST, 24)

    expect(resolveRegionSelection(REGION_US_EAST.id, REGIONS, latencies)).toEqual({
      region: REGION_US_EAST.id,
      rttMs: null,
    })
  })

  test('no setting and no measurements: resolves to undefined', () => {
    expect(resolveRegionSelection(undefined, REGIONS, {})).toBeUndefined()
  })
})

describe('resolveDesiredRegion', () => {
  afterEach(() => {
    jotaiStore.set(gameServerRegionsAtom, [])
    jotaiStore.set(manualGameServerRegionAtom, undefined)
    vi.restoreAllMocks()
  })

  test('empty region list: resolves to undefined immediately without touching the app', async () => {
    jotaiStore.set(gameServerRegionsAtom, [])
    const invokeSpy = vi.spyOn(TypedIpcRenderer.prototype, 'invoke')

    const result = await resolveDesiredRegion()

    expect(result).toBeUndefined()
    // No ensure-sweep kick, no latency poll -- there is nothing to measure.
    expect(invokeSpy).not.toHaveBeenCalled()
  })

  test('non-empty region list with an immediate measurement: resolves without polling', async () => {
    jotaiStore.set(gameServerRegionsAtom, REGIONS)
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

    expect(result).toEqual({ region: REGION_US_EAST.id, rttMs: 24 })
    expect(invokeSpy).toHaveBeenCalledTimes(1)
    expect(invokeSpy).toHaveBeenCalledWith('gameServerRegionsGetLatencies')
  })

  test('non-empty region list with no measurement yet: kicks the sweep and polls until one lands', async () => {
    jotaiStore.set(gameServerRegionsAtom, REGIONS)
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

    expect(result).toEqual({ region: REGION_EU_WEST.id, rttMs: 40 })
    expect(invokeSpy).toHaveBeenCalledWith('gameServerRegionsEnsureSweep')
    expect(getLatenciesCalls).toBeGreaterThanOrEqual(2)
  })
})
