import { GameType } from '../../common/games/game-type'
import { LobbyVisibility } from '../../common/lobbies'
import { LobbyPreferencesResponse } from '../../common/lobbies/lobby-network'
import { SbMapId } from '../../common/maps'
import {
  LOBBY_PREFERENCES_GET,
  LOBBY_PREFERENCES_GET_BEGIN,
  LOBBY_PREFERENCES_UPDATE,
} from '../actions'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface LobbyPreferencesState {
  name: string
  gameType: GameType
  gameSubType: number
  recentMaps: SbMapId[]
  selectedMap: SbMapId | null | undefined
  useLegacyLimits: boolean | undefined
  visibility: LobbyVisibility | undefined
  allowObservers: boolean | undefined

  isRequesting: boolean
  hasLoaded: boolean
}

const DEFAULT_STATE: LobbyPreferencesState = {
  name: '',
  gameType: GameType.Melee,
  gameSubType: 0,
  recentMaps: [],
  selectedMap: undefined,
  useLegacyLimits: undefined,
  visibility: undefined,
  allowObservers: undefined,

  isRequesting: false,
  hasLoaded: false,
}

function createPreferences(response: LobbyPreferencesResponse): LobbyPreferencesState {
  return {
    name: response.name ?? '',
    gameType: response.gameType ?? GameType.Melee,
    gameSubType: response.gameSubType ?? 0,
    recentMaps: response.recentMaps.map(m => m.id),
    selectedMap: response.selectedMap,
    useLegacyLimits: response.useLegacyLimits,
    visibility: response.visibility,
    allowObservers: response.allowObservers,

    isRequesting: false,
    hasLoaded: true,
  }
}

export default immerKeyedReducer(DEFAULT_STATE, {
  [LOBBY_PREFERENCES_GET_BEGIN as any]() {
    return { ...DEFAULT_STATE, isRequesting: true }
  },

  [LOBBY_PREFERENCES_GET as any](
    draft: LobbyPreferencesState,
    action: { payload: LobbyPreferencesResponse; error?: false } | { payload: Error; error: true },
  ) {
    if (action.error) {
      return { ...draft, isRequesting: false, hasLoaded: true }
    }

    return createPreferences(action.payload)
  },

  [LOBBY_PREFERENCES_UPDATE as any](
    draft: LobbyPreferencesState,
    action: { payload: LobbyPreferencesResponse; error?: false } | { payload: Error; error: true },
  ) {
    if (action.error) {
      return { ...draft, isRequesting: false, hasLoaded: true }
    }

    return createPreferences(action.payload)
  },
})
