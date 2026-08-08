import { singleton } from 'tsyringe'
import { SbMapId, toMapInfoJson } from '../../../common/maps'
import {
  ALL_MATCHMAKING_TYPES,
  defaultPreferences,
  getMatchmakingModeInfo,
  GetPreferencesResponse,
  MatchmakingPreferences,
  MatchmakingType,
  PartialMatchmakingPreferences,
} from '../../../common/matchmaking'
import { MatchmakingMapPool } from '../../../common/matchmaking/matchmaking-map-pools'
import { SbUserId } from '../../../common/users/sb-user-id'
import { DbClient, withDbClient } from '../db'
import logger from '../logging/logger'
import { getMapInfos } from '../maps/map-models'
import { ClientSocketsManager } from '../websockets/socket-groups'
import { getCurrentMapPools } from './matchmaking-map-pools-models'
import {
  getAllMatchmakingPreferences,
  setSelectedMatchmakingTypes,
  StoredMatchmakingPreferences,
  upsertManyMatchmakingPreferences,
  upsertMatchmakingPreferences,
} from './matchmaking-preferences-model'

export function getMatchmakingPreferencesPath(
  userId: SbUserId,
  matchmakingType: MatchmakingType,
): string {
  return `/matchmaking-preferences/${userId}/${matchmakingType}`
}

/**
 * Builds the preferences we hand back for a user who hasn't saved any for this type yet. Pick modes
 * need a non-empty map selection to be queueable (the matchmaker rejects an empty selection), so we
 * default them to the entire current pool ("happy to play any of these"); veto and fixed modes
 * default to an empty selection.
 */
function buildDefaultPreferences(
  matchmakingType: MatchmakingType,
  userId: SbUserId,
  currentMapPool: MatchmakingMapPool | null,
): MatchmakingPreferences {
  const prefs = defaultPreferences(matchmakingType, userId, currentMapPool?.id ?? 1)
  if (currentMapPool && getMatchmakingModeInfo(matchmakingType).mapSelectionStyle === 'pick') {
    prefs.mapSelections = [...currentMapPool.maps]
  }
  return prefs
}

/**
 * The response we fall back to when a type's data can't be loaded: synthesized defaults with no map
 * pool, so a data problem degrades that type rather than failing the subscription.
 */
function buildFallbackResponse(
  matchmakingType: MatchmakingType,
  userId: SbUserId,
): GetPreferencesResponse {
  return {
    preferences: buildDefaultPreferences(matchmakingType, userId, null),
    currentMapPoolId: 1,
    mapInfos: [],
    selected: false,
  }
}

/** A type's preferences, resolved against its map pool but not yet joined with map info. */
interface ResolvedPreferences {
  preferences: MatchmakingPreferences
  selected: boolean
  currentMapPoolId: number
  /** The selected maps that are in the current pool, in the order they'll be sent to the client. */
  mapIds: SbMapId[]
}

function resolvePreferences(
  matchmakingType: MatchmakingType,
  userId: SbUserId,
  currentMapPool: MatchmakingMapPool | null,
  stored: StoredMatchmakingPreferences | undefined,
): ResolvedPreferences {
  // If the user has never saved preferences for this type, we synthesize defaults rather than
  // signalling "missing", so every read site can rely on a full preferences object. A synthesized
  // default is never `selected` — only types the user has actually queued for get marked.
  const preferences =
    stored?.preferences ?? buildDefaultPreferences(matchmakingType, userId, currentMapPool)
  return {
    preferences,
    selected: stored?.selected ?? false,
    currentMapPoolId: currentMapPool?.id ?? 1,
    mapIds: currentMapPool
      ? preferences.mapSelections.filter(m => currentMapPool.maps.includes(m))
      : [],
  }
}

/**
 * Builds the preferences response for every matchmaking type for a user, using a fixed number of
 * queries: one for all the current map pools, one for all of the user's stored preferences, and one
 * for every map they reference. Loading each type separately would instead take a pool connection
 * per type. The result has an entry for every matchmaking type.
 */
async function loadAllPreferences(
  userId: SbUserId,
): Promise<Map<MatchmakingType, GetPreferencesResponse>> {
  const { mapPools, stored } = await withDbClient(async client => {
    const mapPools = await getCurrentMapPools(ALL_MATCHMAKING_TYPES, client)
    const stored = await getAllMatchmakingPreferences(userId, client)
    return { mapPools, stored }
  })

  const responses = new Map<MatchmakingType, GetPreferencesResponse>()
  const resolved = new Map<MatchmakingType, ResolvedPreferences>()
  const neededMapIds = new Set<SbMapId>()
  for (const matchmakingType of ALL_MATCHMAKING_TYPES) {
    try {
      const typePreferences = resolvePreferences(
        matchmakingType,
        userId,
        mapPools.get(matchmakingType) ?? null,
        stored.get(matchmakingType),
      )
      resolved.set(matchmakingType, typePreferences)
      for (const mapId of typePreferences.mapIds) {
        neededMapIds.add(mapId)
      }
    } catch (err) {
      logger.error({ err }, 'error retrieving user matchmaking preferences')
      responses.set(matchmakingType, buildFallbackResponse(matchmakingType, userId))
    }
  }

  const mapInfoById = new Map(
    (await getMapInfos(Array.from(neededMapIds))).map(m => [m.id, toMapInfoJson(m)]),
  )
  for (const [matchmakingType, typePreferences] of resolved) {
    responses.set(matchmakingType, {
      preferences: typePreferences.preferences,
      currentMapPoolId: typePreferences.currentMapPoolId,
      mapInfos: typePreferences.mapIds
        .map(mapId => mapInfoById.get(mapId))
        .filter(info => info !== undefined),
      selected: typePreferences.selected,
    })
  }

  return responses
}

@singleton()
export default class MatchmakingPreferencesService {
  constructor(private clientSocketsManager: ClientSocketsManager) {
    this.clientSocketsManager.on('newClient', c => {
      // Every type's subscription is registered in one go and their data getters run in the same
      // tick, so they share a single batched load instead of each running its own queries. The
      // shared promise is dropped once it settles, so a socket that joins this client later reloads
      // rather than getting a stale snapshot.
      let pendingLoad: Promise<Map<MatchmakingType, GetPreferencesResponse>> | undefined
      const loadPreferences = () => {
        if (!pendingLoad) {
          const load = loadAllPreferences(c.userId)
          const clearPending = () => {
            if (pendingLoad === load) {
              pendingLoad = undefined
            }
          }
          load.then(clearPending, clearPending)
          pendingLoad = load
        }
        return pendingLoad
      }

      for (const matchmakingType of ALL_MATCHMAKING_TYPES) {
        c.subscribe<GetPreferencesResponse>(
          getMatchmakingPreferencesPath(c.userId, matchmakingType),
          async () => {
            try {
              return (
                (await loadPreferences()).get(matchmakingType) ??
                buildFallbackResponse(matchmakingType, c.userId)
              )
            } catch (err) {
              logger.error({ err }, 'error retrieving user matchmaking preferences')
              return buildFallbackResponse(matchmakingType, c.userId)
            }
          },
        )
      }
    })
  }

  /**
   * Service method to upsert matchmaking preferences. Should be used by other services instead of
   * calling the DB method directly.
   */
  upsertPreferences(preferences: PartialMatchmakingPreferences) {
    return upsertMatchmakingPreferences(preferences)
  }

  /**
   * Upserts a batch of complete preferences in a single statement (see
   * `upsertManyMatchmakingPreferences`). Used by the queue path to persist every queued type at once
   * without a per-type query fan-out. Pass `withClient` to run inside a transaction.
   */
  upsertManyPreferences(preferences: ReadonlyArray<MatchmakingPreferences>, withClient?: DbClient) {
    return upsertManyMatchmakingPreferences(preferences, withClient)
  }

  /**
   * Marks exactly the given matchmaking types as the user's current selection (clearing the flag on
   * the rest), so the find-match page can restore which modes they want to queue across sessions and
   * devices. Callers should upsert the queued types' preferences first so their rows exist. Pass
   * `withClient` to run inside a transaction.
   */
  setSelectedTypes(
    userId: SbUserId,
    selectedTypes: ReadonlyArray<MatchmakingType>,
    withClient?: DbClient,
  ) {
    return setSelectedMatchmakingTypes(userId, selectedTypes, withClient)
  }
}
