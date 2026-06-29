import { singleton } from 'tsyringe'
import { toMapInfoJson } from '../../../common/maps'
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
import { DbClient } from '../db'
import logger from '../logging/logger'
import { getMapInfos } from '../maps/map-models'
import { ClientSocketsManager } from '../websockets/socket-groups'
import { getCurrentMapPool } from './matchmaking-map-pools-models'
import {
  getMatchmakingPreferences,
  setSelectedMatchmakingTypes,
  upsertManyMatchmakingPreferences,
  upsertMatchmakingPreferences,
} from './matchmaking-preferences-model'

export function getMatchmakingPreferencesPath(
  userId: SbUserId,
  matchmakingType: MatchmakingType,
): string {
  return `/matchmakingPreferences/${userId}/${matchmakingType}`
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

@singleton()
export default class MatchmakingPreferencesService {
  constructor(private clientSocketsManager: ClientSocketsManager) {
    this.clientSocketsManager.on('newClient', c => {
      for (const matchmakingType of ALL_MATCHMAKING_TYPES) {
        c.subscribe<GetPreferencesResponse>(
          getMatchmakingPreferencesPath(c.userId, matchmakingType),
          async () => {
            try {
              const currentMapPool = await getCurrentMapPool(matchmakingType)
              // If the user has never saved preferences for this type, we synthesize defaults rather
              // than signalling "missing", so every read site can rely on a full preferences object.
              // A synthesized default is never `selected` — only types the user has actually queued
              // for get marked.
              const stored = await getMatchmakingPreferences(c.userId, matchmakingType)
              const preferences =
                stored?.preferences ??
                buildDefaultPreferences(matchmakingType, c.userId, currentMapPool)
              const selected = stored?.selected ?? false

              const mapInfos = currentMapPool
                ? (
                    await getMapInfos(
                      preferences.mapSelections.filter(m => currentMapPool.maps.includes(m)),
                    )
                  ).map(m => toMapInfoJson(m))
                : []

              return {
                preferences,
                currentMapPoolId: currentMapPool?.id ?? 1,
                mapInfos,
                selected,
              }
            } catch (err) {
              logger.error({ err }, 'error retrieving user matchmaking preferences')
              return {
                preferences: buildDefaultPreferences(matchmakingType, c.userId, null),
                currentMapPoolId: 1,
                mapInfos: [],
                selected: false,
              }
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
