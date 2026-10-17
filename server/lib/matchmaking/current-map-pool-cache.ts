import { singleton } from 'tsyringe'
import { toMapInfoJson } from '../../../common/maps'
import { MatchmakingType } from '../../../common/matchmaking'
import {
  GetMatchmakingMapPoolResponse,
  toMatchmakingMapPoolJson,
} from '../../../common/matchmaking/matchmaking-map-pools'
import { getMapInfos } from '../maps/map-models'
import { Clock } from '../time/clock'
import { getCurrentMapPool, getNextMapPoolStartDate } from './matchmaking-map-pools-models'

/**
 * How long the signed download URLs for a map pool's maps stay valid. Clients keep a pool for as
 * long as it's current, and every player in a matchmaking type can already see its pool's maps, so
 * these outlive the store's default lifetime by a wide margin.
 */
export const MAP_POOL_MAP_URL_EXPIRES_SEC = 24 * 60 * 60

/**
 * The longest a loaded current map pool is served before being reloaded. The response carries
 * signed map download URLs, so this must stay well under their lifetime.
 */
export const CURRENT_MAP_POOL_TTL_MS = 60 * 1000

interface CacheEntry {
  expiresAt: number
  response: Promise<GetMatchmakingMapPoolResponse | undefined>
}

/**
 * Serves the current map pool for each matchmaking type. Every connected client loads these, so
 * concurrent requests share a single load, and a loaded pool is kept until the TTL passes or the
 * next scheduled pool for that type starts, whichever comes first.
 */
@singleton()
export class CurrentMapPoolCache {
  private entries = new Map<MatchmakingType, CacheEntry>()

  constructor(private clock: Clock) {}

  /** Returns the current map pool for `matchmakingType`, or `undefined` if it has none. */
  get(matchmakingType: MatchmakingType): Promise<GetMatchmakingMapPoolResponse | undefined> {
    const now = this.clock.now()
    const existing = this.entries.get(matchmakingType)
    if (existing && now < existing.expiresAt) {
      return existing.response
    }

    const entry: CacheEntry = {
      expiresAt: now + CURRENT_MAP_POOL_TTL_MS,
      response: Promise.resolve(undefined),
    }
    entry.response = this.load(matchmakingType, now).then(
      ({ response, nextStart }) => {
        if (nextStart !== undefined) {
          entry.expiresAt = Math.min(entry.expiresAt, nextStart)
        }
        return response
      },
      (err: unknown) => {
        if (this.entries.get(matchmakingType) === entry) {
          this.entries.delete(matchmakingType)
        }
        throw err
      },
    )
    this.entries.set(matchmakingType, entry)
    return entry.response
  }

  /**
   * Drops the cached pool for `matchmakingType`, so the next request reloads it. Must be called
   * whenever that type's pools are added or removed, since that can change which pool starts next.
   */
  invalidate(matchmakingType: MatchmakingType) {
    this.entries.delete(matchmakingType)
  }

  private async load(
    matchmakingType: MatchmakingType,
    now: number,
  ): Promise<{ response: GetMatchmakingMapPoolResponse | undefined; nextStart?: number }> {
    // Looked up relative to the time the load began, so a pool that starts while this load is
    // running is either returned as current or ends this entry's lifetime immediately.
    const nextStartDate = await getNextMapPoolStartDate(matchmakingType, new Date(now))
    const nextStart = nextStartDate ? Number(nextStartDate) : undefined

    const pool = await getCurrentMapPool(matchmakingType)
    if (!pool) {
      return { response: undefined, nextStart }
    }

    const mapInfos = await getMapInfos(pool.maps, {
      mapUrlExpiresSec: MAP_POOL_MAP_URL_EXPIRES_SEC,
    })
    return {
      response: {
        pool: toMatchmakingMapPoolJson(pool),
        mapInfos: mapInfos.map(m => toMapInfoJson(m)),
      },
      nextStart,
    }
  }
}
