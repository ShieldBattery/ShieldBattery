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
import logger from '../logging/logger'
import { getMapInfos } from '../maps/map-models'
import { ClientSocketsManager } from '../websockets/socket-groups'
import { getCurrentMapPool } from './matchmaking-map-pools-models'
import {
  getMatchmakingPreferences,
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
              const preferences =
                (await getMatchmakingPreferences(c.userId, matchmakingType)) ??
                buildDefaultPreferences(matchmakingType, c.userId, currentMapPool)

              const mapPoolOutdated =
                !!currentMapPool && preferences.mapPoolId !== currentMapPool.id
              const mapInfos = currentMapPool
                ? (
                    await getMapInfos(
                      preferences.mapSelections.filter(m => currentMapPool.maps.includes(m)),
                    )
                  ).map(m => toMapInfoJson(m))
                : []

              return {
                preferences,
                mapPoolOutdated,
                currentMapPoolId: currentMapPool?.id ?? 1,
                mapInfos,
              }
            } catch (err) {
              logger.error({ err }, 'error retrieving user matchmaking preferences')
              return {
                preferences: buildDefaultPreferences(matchmakingType, c.userId, null),
                mapPoolOutdated: false,
                currentMapPoolId: 1,
                mapInfos: [],
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
}
