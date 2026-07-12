import {
  GameServerRegion,
  GameServerRegionId,
  GameServerRegionLatencies,
  RegionLatency,
} from '../../common/game-server-regions'
import { TypedIpcRenderer } from '../../common/ipc'
import { jotaiStore } from '../jotai-store'
import { gameServerRegionsAtom, manualGameServerRegionAtom } from './game-server-regions-atoms'

const ipcRenderer = new TypedIpcRenderer()

/** The player's chosen home region and their measured round-trip time (ms) to it, if any. */
export interface DesiredRegion {
  region: GameServerRegionId
  /** Null when the region came from a manual pick that hasn't been measured yet. */
  rttMs: number | null
}

/**
 * How long to keep polling the app for a first region measurement before queueing region-less. The
 * app sweeps regions at startup and a full sweep takes ~2s, so a few seconds covers the cold case
 * where the player hits "find match" before the first sweep finishes. Only applies to the Auto
 * path -- a manual pick resolves immediately whether or not it's been measured yet.
 */
const REGION_RESOLVE_TIMEOUT_MS = 4000
/** How often to re-poll the app's latency table while waiting for a first measurement. */
const REGION_POLL_INTERVAL_MS = 500

/**
 * Picks the lowest-RTT region from a measured latency table -- the "Auto" resolution. Returns
 * undefined when the table has no measurements yet.
 */
export function pickAutoRegion(latencies: GameServerRegionLatencies): DesiredRegion | undefined {
  let best: RegionLatency | undefined
  for (const latency of Object.values(latencies)) {
    if (latency && (best === undefined || latency.rttMs < best.rttMs)) {
      best = latency
    }
  }
  return best ? { region: best.regionId, rttMs: best.rttMs } : undefined
}

/**
 * Resolves a manual region setting against the server-provided region list. A manual pick that's
 * no longer in the list (the operator removed it, or the setting predates the list ever loading)
 * is treated as unset, the same as never having picked one.
 */
export function resolveManualRegion(
  manualRegionId: GameServerRegionId | undefined,
  regions: ReadonlyArray<GameServerRegion>,
): GameServerRegion | undefined {
  return manualRegionId !== undefined
    ? regions.find(region => region.id === manualRegionId)
    : undefined
}

/**
 * Resolves the desired region from the manual "Server region" setting and the measured latency
 * table: a manual pick still present in the region list wins (with its measured rtt, or null if
 * unmeasured); otherwise falls back to the lowest-RTT region in the table (the "Auto" resolution).
 */
export function resolveRegionSelection(
  manualRegionId: GameServerRegionId | undefined,
  regions: ReadonlyArray<GameServerRegion>,
  latencies: GameServerRegionLatencies,
): DesiredRegion | undefined {
  const manualRegion = resolveManualRegion(manualRegionId, regions)
  if (manualRegion) {
    return { region: manualRegion.id, rttMs: latencies[manualRegion.id]?.rttMs ?? null }
  }

  return pickAutoRegion(latencies)
}

/**
 * Resolves the player's desired region before queueing for matchmaking or joining a lobby: the
 * manual "Server region" setting if it's set and still in the server-provided region list,
 * otherwise the app's measured latency table. If Auto has no measurement yet, polls briefly (the
 * startup sweep may still be in flight) and, if still empty, resolves to undefined so the player
 * queues region-less -- a user with no coordinator-configured regions (dev loopback) must still be
 * able to queue. This client-side wait takes the place of the server's old ping-measurement gate.
 */
export async function resolveDesiredRegion(): Promise<DesiredRegion | undefined> {
  const manualRegionId = jotaiStore.get(manualGameServerRegionAtom)
  const regions = jotaiStore.get(gameServerRegionsAtom)

  const readSelection = async () =>
    resolveRegionSelection(
      manualRegionId,
      regions,
      (await ipcRenderer.invoke('gameServerRegionsGetLatencies')) ?? {},
    )

  let resolved = await readSelection()
  const deadline = Date.now() + REGION_RESOLVE_TIMEOUT_MS
  while (!resolved && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, REGION_POLL_INTERVAL_MS))
    resolved = await readSelection()
  }
  return resolved
}
