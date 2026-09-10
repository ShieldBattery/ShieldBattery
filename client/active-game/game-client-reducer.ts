import { ReadonlyDeep } from 'type-fest'
import { GameStatusString, ReportedGameStatus } from '../../common/games/game-status'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface GameClientState {
  gameId?: string
  status?: ReportedGameStatus
}

const DEFAULT_STATE: ReadonlyDeep<GameClientState> = {
  gameId: undefined,
  status: undefined,
}

const IN_ACTIVE_GAME_STATES: ReadonlySet<GameStatusString> = new Set([
  'launching',
  'configuring',
  'awaitingPlayers',
  'starting',
  'playing',
  'hasResult',
  'resultSent',
])

/**
 * Returns whether this client currently has a game process up: from the moment a launch is
 * reported until the game has finished or failed. A game that has a result but hasn't exited yet
 * (the score screen) still counts, as does a replay, since either keeps the user in the
 * fullscreen game.
 */
export function isInActiveGame(state: ReadonlyDeep<GameClientState>): boolean {
  return state.status !== undefined && IN_ACTIVE_GAME_STATES.has(state.status.state)
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@active-game/launch'](state, action) {
    if (action.error) {
      return DEFAULT_STATE
    }

    return action.payload === null ? DEFAULT_STATE : { gameId: action.payload }
  },

  ['@active-game/status'](state, { payload }) {
    state.gameId = payload.id
    state.status = { ...payload }
  },
})
