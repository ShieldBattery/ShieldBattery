import { Immutable } from 'immer'
import { List, Map, Record } from 'immutable'
import { GameType } from '../../common/games/configuration'
import { MapInfoJson } from '../../common/maps'
import {
  LOBBY_PREFERENCES_GET,
  LOBBY_PREFERENCES_GET_BEGIN,
  LOBBY_PREFERENCES_UPDATE,
} from '../actions'
import { keyedReducer } from '../reducers/keyed-reducer'

export class RecentMaps extends Record({
  list: List<string>(),
  // TODO(tec27): Don't store anything but IDs here, use the main maps reducer instead
  byId: Map<string, Immutable<MapInfoJson>>(),
}) {}

export class LobbyPreferences extends Record({
  name: '',
  gameType: GameType.Melee,
  gameSubType: 0,
  recentMaps: new RecentMaps(),
  selectedMap: undefined as string | undefined,

  isRequesting: false,
  // NOTE(2Pac): We don't actually display this anywhere since it's not that useful to the user
  lastError: undefined as Error | undefined,
}) {}

export function recentMapsFromJs(recentMaps: Immutable<MapInfoJson[]>) {
  return new RecentMaps({
    list: List(recentMaps.map(m => m.id)),
    byId: Map(recentMaps.map(m => [m.id, m])),
  })
}

function createPreferences(preferences: any) {
  return new LobbyPreferences({
    ...preferences,
    recentMaps: recentMapsFromJs(preferences.recentMaps),
    isRequesting: false,
    lastError: null,
  })
}

export default keyedReducer(new LobbyPreferences(), {
  [LOBBY_PREFERENCES_GET_BEGIN as any](state: LobbyPreferences, action: any) {
    return new LobbyPreferences({ isRequesting: true })
  },

  [LOBBY_PREFERENCES_GET as any](state: LobbyPreferences, action: any) {
    if (action.error) {
      return state.set('isRequesting', false).set('lastError', action.payload)
    }

    return createPreferences(action.payload)
  },

  [LOBBY_PREFERENCES_UPDATE as any](state: LobbyPreferences, action: any) {
    if (action.error) {
      return state.set('isRequesting', false).set('lastError', action.payload)
    }

    return createPreferences(action.payload)
  },
})
