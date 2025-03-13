import { List, Record } from 'immutable'
import { GameType } from '../../common/games/game-type'
import { MapInfoJson } from '../../common/maps'
import { BwTurnRate } from '../../common/network'
import {
  LOBBY_PREFERENCES_GET,
  LOBBY_PREFERENCES_GET_BEGIN,
  LOBBY_PREFERENCES_UPDATE,
} from '../actions'
import { keyedReducer } from '../reducers/keyed-reducer'

export class LobbyPreferences extends Record({
  name: '',
  gameType: GameType.Melee,
  gameSubType: 0,
  recentMaps: List<string>(),
  selectedMap: undefined as string | undefined,
  turnRate: undefined as BwTurnRate | 0 | undefined,
  useLegacyLimits: undefined as boolean | undefined,

  isRequesting: false,
  hasLoaded: false,
}) {}

function createPreferences(preferences: any) {
  return new LobbyPreferences({
    ...preferences,
    recentMaps: List(preferences.recentMaps.map((m: MapInfoJson) => m.id)),
    isRequesting: false,
    hasLoaded: true,
  })
}

export default keyedReducer(new LobbyPreferences(), {
  [LOBBY_PREFERENCES_GET_BEGIN as any](state: LobbyPreferences, action: any) {
    return new LobbyPreferences({ isRequesting: true })
  },

  [LOBBY_PREFERENCES_GET as any](state: LobbyPreferences, action: any) {
    if (action.error) {
      return state.set('isRequesting', false).set('hasLoaded', true)
    }

    return createPreferences(action.payload)
  },

  [LOBBY_PREFERENCES_UPDATE as any](state: LobbyPreferences, action: any) {
    if (action.error) {
      return state.set('isRequesting', false).set('hasLoaded', true)
    }

    return createPreferences(action.payload)
  },
})
