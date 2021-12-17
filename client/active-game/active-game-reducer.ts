import { Record } from 'immutable'
import { ACTIVE_GAME_STATUS, LOBBY_UPDATE_GAME_STARTED } from '../actions'
import { LobbyRecord } from '../lobbies/lobby-reducer'
import { MatchmakingMatchRecord } from '../matchmaking/matchmaking-reducer'
import { keyedReducer } from '../reducers/keyed-reducer'

export type GameInfo = LobbyGameInfo | MatchmakingGameInfo

export interface LobbyGameInfo {
  type: 'lobby'
  extra: { lobby: LobbyRecord }
}

export interface MatchmakingGameInfo {
  type: 'matchmaking'
  extra: { match: MatchmakingMatchRecord }
}

export class ActiveGame extends Record({
  isActive: false,
  info: undefined as Readonly<GameInfo> | undefined,
}) {}

// TODO(tec27): Combine this reducer with game-client-reducer, they are so close to the exact
// same thing
export default keyedReducer(new ActiveGame(), {
  [LOBBY_UPDATE_GAME_STARTED as any](state: ActiveGame, action: any) {
    return state.set('isActive', true).set('info', { type: 'lobby', extra: action.payload })
  },

  ['@matchmaking/gameStarted'](state, action) {
    return state.set('isActive', true).set('info', { type: 'matchmaking', extra: action.payload })
  },

  [ACTIVE_GAME_STATUS as any](state: ActiveGame, action: any) {
    const { state: status } = action.payload
    if (status !== 'playing') {
      return new ActiveGame()
    }

    return state
  },
})
