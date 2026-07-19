import { describe, expect, test } from 'vitest'
import {
  GameServerRegion,
  GameServerRegionLatencies,
  makeGameServerRegionId,
} from '../../common/game-server-regions'
import { pickAutoRegion, resolveManualRegion, resolveRegionSelection } from './region-resolution'

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
