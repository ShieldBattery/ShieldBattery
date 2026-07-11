import { Tagged } from 'type-fest'

export type GameServerRegionId = Tagged<string, 'GameServerRegion'>

export function makeGameServerRegionId(id: string): GameServerRegionId {
  return id as GameServerRegionId
}

/**
 * A game server region a player can measure latency to and request a home relay in. The id and
 * ping targets are opaque to ShieldBattery — they come verbatim from the game server coordinator,
 * which owns the region registry and its measurement targets.
 */
export interface GameServerRegion {
  id: GameServerRegionId
  displayName: string
  /** host:port of the region's UDP ping beacon (a DNS hostname, resolved at measurement time). */
  beacon: string
  /**
   * host:port of an always-up TCP endpoint measured by connect time when the beacon path fails.
   */
  fallback: string
}

/**
 * The game server region list, published in full whenever it changes. The list changes rarely
 * (an operator adding/removing a region), so there's no upsert/delete delta protocol — every
 * publish just replaces the whole list.
 */
export interface GameServerRegionsEvent {
  type: 'fullUpdate'
  regions: GameServerRegion[]
}

/** A region's measured latency, as produced by a single measurement attempt. */
export interface RegionLatency {
  regionId: GameServerRegionId
  rttMs: number
  /** Which path produced `rttMs`: the UDP ping beacon, or the TCP-connect fallback. */
  source: 'beacon' | 'fallback'
  /** Wall-clock time (`Date.now()`) the measurement completed. */
  measuredAt: number
}

/**
 * A region-id-keyed table of the latest measured latencies. A region absent from the table means
 * neither the beacon nor the fallback measurement succeeded for it.
 */
export type GameServerRegionLatencies = Partial<Record<GameServerRegionId, RegionLatency>>
