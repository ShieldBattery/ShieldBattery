import { singleton } from 'tsyringe'
import { toMapInfoJson } from '../../../common/maps'
import {
  ALL_MATCHMAKING_TYPES,
  GetPreferencesResponse,
  MatchmakingPreferences,
  MatchmakingType,
  PartialMatchmakingPreferences,
} from '../../../common/matchmaking'
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

@singleton()
export default class MatchmakingPreferencesService {
  constructor(private clientSocketsManager: ClientSocketsManager) {
    this.clientSocketsManager.on('newClient', c => {
      for (const matchmakingType of ALL_MATCHMAKING_TYPES) {
        c.subscribe<GetPreferencesResponse>(
          getMatchmakingPreferencesPath(c.userId, matchmakingType),
          async () => {
            try {
              // Undefined means the user doesn't have any matchmaking preferences saved yet. We
              // send an empty object instead of `undefined` so the client knows their preferences
              // have been initialized and aren't simply missing.
              const preferences: MatchmakingPreferences | Record<string, never> =
                (await getMatchmakingPreferences(c.userId, matchmakingType)) ?? {}
              const mapSelections = preferences.mapSelections ?? []
              const currentMapPool = await getCurrentMapPool(matchmakingType)

              const mapPoolOutdated =
                !!currentMapPool &&
                'mapPoolId' in preferences &&
                preferences.mapPoolId !== currentMapPool.id
              const mapInfos = currentMapPool
                ? (
                    await getMapInfos(mapSelections.filter(m => currentMapPool.maps.includes(m)))
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
                preferences: {},
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
