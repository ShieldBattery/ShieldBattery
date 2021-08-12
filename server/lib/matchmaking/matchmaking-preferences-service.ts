import { singleton } from 'tsyringe'
import { toMapInfoJson } from '../../../common/maps'
import {
  ALL_MATCHMAKING_TYPES,
  GetPreferencesPayload,
  MatchmakingPreferences,
  MatchmakingType,
} from '../../../common/matchmaking'
import logger from '../logging/logger'
import { getMapInfo } from '../maps/map-models'
import { getCurrentMapPool } from '../models/matchmaking-map-pools'
import { ClientSocketsManager } from '../websockets/socket-groups'
import {
  getMatchmakingPreferences,
  upsertMatchmakingPreferences,
} from './matchmaking-preferences-model'

export function getMatchmakingPreferencesPath(
  userId: number,
  matchmakingType: MatchmakingType,
): string {
  return `/matchmakingPreferences/${userId}/${matchmakingType}`
}

@singleton()
export default class MatchmakingPreferencesService {
  constructor(private clientSocketsManager: ClientSocketsManager) {
    this.clientSocketsManager.on('newClient', c => {
      for (const matchmakingType of ALL_MATCHMAKING_TYPES) {
        c.subscribe<GetPreferencesPayload | Record<string, undefined>>(
          getMatchmakingPreferencesPath(c.userId, matchmakingType),
          async () => {
            try {
              const preferences = await getMatchmakingPreferences(c.userId, matchmakingType)
              if (!preferences) {
                // Means the user doesn't have any matchmaking preferences saved yet. We send an
                // empty object instead of `undefined` so the client actually gets an event when
                // they subscribe to this path and they can use default values for this matchmaking
                // type.
                return {}
              }

              const currentMapPool = await getCurrentMapPool(matchmakingType)
              if (!currentMapPool) {
                return {}
              }

              const mapPoolOutdated = preferences.mapPoolId !== currentMapPool.id
              const mapInfos = (
                await getMapInfo(
                  preferences.mapSelections.filter(m => currentMapPool.maps.includes(m)),
                )
              ).map(m => toMapInfoJson(m))

              return {
                preferences,
                mapPoolOutdated,
                mapInfos,
              }
            } catch (err) {
              logger.error({ err }, 'error retrieving user matchmaking preferences')
              return {}
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
  upsertPreferences(props: MatchmakingPreferences) {
    return upsertMatchmakingPreferences(props)
  }
}
