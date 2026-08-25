import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import {
  GameServerRegion,
  GameServerRegionId,
  GameServerRegionLatencies,
  RegionLatency,
} from '../../common/game-server-regions'
import { TypedIpcRenderer } from '../../common/ipc'
import { jotaiStore } from '../jotai-store'
import {
  gameServerRegionsAtom,
  gameServerRegionsReadyAtom,
  manualGameServerRegionAtom,
} from './game-server-regions-atoms'

const ipcRenderer = new TypedIpcRenderer()

/** The player's chosen home region and their measured round-trip time (ms) to it, if any. */
export interface DesiredRegion {
  region: GameServerRegionId
  /** Null when the region came from a manual pick that hasn't been measured yet. */
  rttMs: number | null
}

/**
 * How long to keep polling the app for a first region measurement before queueing region-less.
 * The app normally waits out a startup settling delay before sweeping, but `resolveDesiredRegion`
 * kicks that sweep early (see `gameServerRegionsEnsureSweep` below) once it finds no usable
 * measurement, and a from-cold sweep takes ~2s plus inter-region stagger -- a few seconds of
 * headroom covers that. Only applies to the Auto path -- a manual pick resolves immediately
 * whether or not it's been measured yet.
 */
const REGION_RESOLVE_TIMEOUT_MS = 6000
/** How often to re-poll the app's latency table while waiting for a first measurement. */
const REGION_POLL_INTERVAL_MS = 500

/**
 * Picks the lowest-RTT region from a measured latency table -- the "Auto" resolution. Returns
 * undefined when the table has no measurement for any current region.
 *
 * Only regions in the server-provided `regions` list are candidates: the table can carry entries
 * the list no longer names (the app persists measurements across runs, and serves them as stale
 * hints until its first sweep of the current list completes), and a retired region must not win
 * the pick -- the server would refuse or ignore it, losing region-aware placement the current
 * list could have provided.
 */
export function pickAutoRegion(
  regions: ReadonlyArray<GameServerRegion>,
  latencies: GameServerRegionLatencies,
): DesiredRegion | undefined {
  let best: RegionLatency | undefined
  for (const latency of Object.values(latencies)) {
    if (
      latency &&
      regions.some(region => region.id === latency.regionId) &&
      (best === undefined || latency.rttMs < best.rttMs)
    ) {
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

  return pickAutoRegion(regions, latencies)
}

/** One evaluation of the current region/latency state -- see `resolveDesiredRegion`. */
type ResolutionCheck =
  /** A region resolved; stop polling. */
  | { state: 'resolved'; region: DesiredRegion }
  /** The region list is settled and empty; queue region-less, immediately. */
  | { state: 'noRegions' }
  /** No answer yet (list not loaded, or no usable measurement); keep polling. */
  | { state: 'pending' }

/**
 * Resolves the player's desired region before queueing for matchmaking or joining a lobby: the
 * manual "Server region" setting if it's set and still in the server-provided region list,
 * otherwise the app's measured latency table. If no answer exists yet, polls briefly and, if
 * still empty at the deadline, resolves to undefined so the player queues region-less. This
 * client-side wait takes the place of the server's old ping-measurement gate.
 *
 * Two things can be unanswered: the measurement (the app's startup sweep may still be in flight
 * -- the first check kicks it to skip the rest of its settling delay) and the region list itself
 * (the server hands a cold cache to early subscribers, so an empty list is only authoritative
 * once its readiness flag says so -- see `gameServerRegionsReadyAtom`). Both are re-read on every
 * poll, so a list or measurement that lands mid-window is used. A *settled* empty list
 * short-circuits to undefined immediately, with no sweep kick and no polling: there is nothing to
 * measure (dev loopback, or no coordinator regions configured), so waiting could never produce a
 * result and would only delay the join/queue.
 */
export async function resolveDesiredRegion(): Promise<DesiredRegion | undefined> {
  const check = async (): Promise<ResolutionCheck> => {
    const regions = jotaiStore.get(gameServerRegionsAtom)
    if (regions.length === 0) {
      return jotaiStore.get(gameServerRegionsReadyAtom)
        ? { state: 'noRegions' }
        : { state: 'pending' }
    }
    const selection = resolveRegionSelection(
      jotaiStore.get(manualGameServerRegionAtom),
      regions,
      (await ipcRenderer.invoke('gameServerRegionsGetLatencies')) ?? {},
    )
    return selection ? { state: 'resolved', region: selection } : { state: 'pending' }
  }

  let result = await check()
  if (result.state === 'pending') {
    // No usable measurement yet -- ask the app to skip the rest of its startup settling delay
    // instead of waiting for it to elapse on its own.
    await ipcRenderer.invoke('gameServerRegionsEnsureSweep')?.catch(swallowNonBuiltins)
  }
  // Monotonic clock: this bounds an elapsed wait, and the wall clock can step (NTP, manual
  // changes) while we poll.
  const deadline = performance.now() + REGION_RESOLVE_TIMEOUT_MS
  while (result.state === 'pending' && performance.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, REGION_POLL_INTERVAL_MS))
    result = await check()
  }
  return result.state === 'resolved' ? result.region : undefined
}
