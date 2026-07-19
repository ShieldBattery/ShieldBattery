import got from 'got'
import { isDeepStrictEqual } from 'node:util'
import { singleton } from 'tsyringe'
import { ReadonlyDeep } from 'type-fest'
import {
  GameServerRegion,
  GameServerRegionsEvent,
  makeGameServerRegionId,
} from '../../../common/game-server-regions'
import log from '../logging/logger'
import { loadConfigFromEnv } from '../netcode-v2/netcode-v2-config'
import { Clock } from '../time/clock'
import { ClientSocketsManager } from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'

const REGIONS_UPDATE_PATH = '/gameServerRegions'

/**
 * How long a fetched region list is trusted before a demand triggers a background re-fetch. The
 * list only changes when an operator edits the coordinator's region config, so a stale-for-a-while
 * cache is cheap to accept in exchange for not hitting the coordinator on every demand.
 */
const CACHE_TTL_MS = 10 * 60 * 1000

/**
 * The minimum time between fetch attempts after one fails, so a burst of demand (many clients
 * connecting, many server-side `getRegions()` calls) while the coordinator is unreachable
 * collapses into a trickle of retries instead of a request per demand.
 */
const RETRY_BACKOFF_MS = 30 * 1000

/** The coordinator's `GET /regions` wire shape: snake_case, ping targets as `host:port` strings. */
interface CoordinatorRegion {
  id: string
  display_name: string
  beacon: string
  fallback: string
}

/**
 * One region pair's relay-measured backbone round-trip time, as served by the coordinator on
 * `GET /regions`. Sorted pair (`a < b`); `measured_at` is a unix-seconds timestamp that drifts on
 * nearly every fetch as relays re-measure, so it's parsed but never compared for change detection.
 */
interface CoordinatorBackboneRtt {
  a: string
  b: string
  rtt_ms: number
  measured_at: number
}

interface CoordinatorRegionsResponse {
  regions: CoordinatorRegion[]
  /**
   * Absent on a coordinator that predates backbone RTT serving, and omitted by a current
   * coordinator when the fleet hasn't measured any pair yet — both cases are just an empty table.
   */
  backbone_rtts?: CoordinatorBackboneRtt[]
}

function toGameServerRegion(region: CoordinatorRegion): GameServerRegion {
  return {
    id: makeGameServerRegionId(region.id),
    displayName: region.display_name,
    beacon: region.beacon,
    fallback: region.fallback,
  }
}

/**
 * Maps the coordinator's sorted-pair backbone RTT list into the `"a|b" -> rtt_ms` lookup shape
 * `BackboneRttTable` consumes, keyed exactly as served since the coordinator already sorts `a < b`.
 */
function toBackboneRttMap(
  entries: CoordinatorBackboneRtt[] | undefined,
): ReadonlyMap<string, number> {
  const map = new Map<string, number>()
  for (const entry of entries ?? []) {
    map.set(`${entry.a}|${entry.b}`, entry.rtt_ms)
  }
  return map
}

/**
 * Fetches the game server region list from the netcode v2 coordinator, caches it, and distributes
 * it to Electron clients — the same subscribe-at-connect/publish-on-change shape the v1
 * rally-point server list uses.
 *
 * Fetching is demand-driven rather than started at server boot: the coordinator and the app
 * server have no guaranteed startup order (the local dev stack routinely brings the app server up
 * before the coordinator), so a boot-time fetch would just fail and leave the service serving
 * nothing until something later happened to retry it. Instead, the first Electron client
 * subscription or server-side `getRegions()` call triggers a fetch, and every later demand just
 * checks the cache's age rather than a standing interval refreshing it — nothing runs while nobody
 * is asking.
 *
 * Dormant (always serving an empty list, no coordinator calls) when netcode v2 has no coordinator
 * configured. Once configured, a failed fetch keeps serving whatever list was last fetched
 * successfully — the list is required for players to pick a home region, and changes rarely enough
 * that a stale version beats no version because the coordinator hiccuped — and gates the next
 * attempt behind a short backoff so repeated demand against a down coordinator doesn't turn into a
 * request storm.
 */
@singleton()
export class GameServerRegionsService {
  private regions: GameServerRegion[] = []
  /**
   * The served backbone RTT pair table, keyed `"a|b"`. Cached beside `regions` on the same
   * fetch/TTL machinery, but kept out of `currentEvent()`/the publish change-detection — see
   * `fetchAndApply`.
   */
  private backboneRtts: ReadonlyMap<string, number> = new Map()
  private readonly config = loadConfigFromEnv()

  /** Monotonic time of the last successful fetch; undefined until one has ever succeeded. */
  private lastFetchedAt: number | undefined
  /** Monotonic time of the last failed fetch; undefined once a fetch succeeds. */
  private lastFailedAt: number | undefined
  /** The shared promise for a fetch currently in flight, deduplicating concurrent demand. */
  private inFlightFetch: Promise<GameServerRegion[]> | undefined

  constructor(
    private publisher: TypedPublisher<GameServerRegionsEvent>,
    private clientSocketsManager: ClientSocketsManager,
    private clock: Clock,
  ) {
    this.clientSocketsManager.on('newClient', c => {
      if (c.clientType === 'electron') {
        c.subscribe<GameServerRegionsEvent>(REGIONS_UPDATE_PATH, () => {
          // Never block the subscription on the coordinator round trip: hand back whatever's
          // cached now (empty before the first successful fetch), and let a fullUpdate publish
          // catch this client up if a triggered fetch changes the list.
          this.refreshInBackgroundIfStale()
          return this.currentEvent()
        })
      }
    })
  }

  /**
   * The current region list, for server-side consumers (e.g. validating a submitted region id).
   *
   * Awaits the first fetch if the cache has never been populated, bounded by that fetch's own
   * request timeout. Otherwise returns the cache immediately and, if it's gone stale, kicks a
   * background re-fetch without making the caller wait for it.
   */
  async getRegions(): Promise<ReadonlyDeep<GameServerRegion[]>> {
    if (this.lastFetchedAt === undefined) {
      const result = await this.ensureFetch()
      return result as ReadonlyDeep<GameServerRegion[]>
    }

    this.refreshInBackgroundIfStale()
    return this.regions as ReadonlyDeep<GameServerRegion[]>
  }

  /**
   * The served backbone RTT pair table (keyed `"a|b"`, `a < b` lexicographically), for combining
   * with an operator override into the effective table a session's latency estimate uses.
   *
   * Shares `getRegions()`'s staleness/refresh logic: awaits the first fetch if the cache has never
   * been populated, otherwise returns the cache immediately and kicks a background re-fetch if it's
   * stale. Empty (rather than throwing or blocking indefinitely) whenever no coordinator is
   * configured, a fetch is failing, or none has served any pair yet.
   */
  async getBackboneRtts(): Promise<ReadonlyMap<string, number>> {
    if (this.lastFetchedAt === undefined) {
      await this.ensureFetch()
      return this.backboneRtts
    }

    this.refreshInBackgroundIfStale()
    return this.backboneRtts
  }

  /** Kicks a background re-fetch if the cache is stale (or was never populated). Never blocks. */
  private refreshInBackgroundIfStale(): void {
    if (!this.config) {
      return
    }

    const isStale =
      this.lastFetchedAt === undefined ||
      this.clock.monotonicNow() - this.lastFetchedAt >= CACHE_TTL_MS
    if (isStale) {
      this.ensureFetch().catch(() => {})
    }
  }

  /**
   * Returns the shared in-flight fetch if one is running (deduplicating concurrent demand),
   * otherwise starts one — unless a recent failure's retry backoff is still in effect, in which
   * case it resolves immediately with the current cache instead of calling the coordinator again.
   */
  private ensureFetch(): Promise<GameServerRegion[]> {
    if (this.inFlightFetch) {
      return this.inFlightFetch
    }
    if (!this.config) {
      return Promise.resolve(this.regions)
    }
    if (
      this.lastFailedAt !== undefined &&
      this.clock.monotonicNow() - this.lastFailedAt < RETRY_BACKOFF_MS
    ) {
      return Promise.resolve(this.regions)
    }

    const promise = this.fetchAndApply(this.config.coordinatorUrl).finally(() => {
      this.inFlightFetch = undefined
    })
    this.inFlightFetch = promise
    return promise
  }

  /** Runs one refresh attempt. Never throws — a failure is logged and the cache left as-is. */
  private async fetchAndApply(coordinatorUrl: string): Promise<GameServerRegion[]> {
    let updated: GameServerRegion[]
    let updatedBackboneRtts: ReadonlyMap<string, number>
    try {
      const response = await got
        .get(`${coordinatorUrl}/regions`, { timeout: { request: 10000 } })
        .json<CoordinatorRegionsResponse>()
      updated = response.regions.map(toGameServerRegion)
      updatedBackboneRtts = toBackboneRttMap(response.backbone_rtts)
    } catch (err) {
      this.lastFailedAt = this.clock.monotonicNow()
      log.error(
        { err },
        'game server regions: failed to fetch region list from coordinator, serving last known list',
      )
      return this.regions
    }

    this.lastFetchedAt = this.clock.monotonicNow()
    this.lastFailedAt = undefined
    // Cached on every successful fetch regardless of whether the region list changed below — pair
    // RTTs (measured_at especially) drift on nearly every fetch, and must never gate or enter the
    // client-facing publish, which stays keyed on the region list only (clients have no use for
    // backbone RTTs, and the list already publishes rarely; the pair table would make it publish on
    // nearly every fetch instead).
    this.backboneRtts = updatedBackboneRtts

    if (!isDeepStrictEqual(updated, this.regions)) {
      this.regions = updated
      log.info(`game server regions: updated list (${updated.length} region(s))`)
      this.publisher.publish(REGIONS_UPDATE_PATH, this.currentEvent())
    }

    return this.regions
  }

  private currentEvent(): GameServerRegionsEvent {
    return { type: 'fullUpdate', regions: this.regions }
  }
}
