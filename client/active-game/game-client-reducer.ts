import { ReadonlyDeep } from 'type-fest'
import { GameStatusString, ReportedGameStatus } from '../../common/games/game-status'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface GameClientState {
  /** The ID of the game the user takes part in (a matchmaking or lobby game), if any. */
  gameId?: string
  /** The status of the game the user takes part in, if any. */
  status?: ReportedGameStatus
  /**
   * The statuses of the games the user only watches (replays) that currently have a process up,
   * keyed by game ID.
   */
  watchOnly: Record<string, ReportedGameStatus>
}

const DEFAULT_STATE: ReadonlyDeep<GameClientState> = {
  gameId: undefined,
  status: undefined,
  watchOnly: {},
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
 * Returns whether this client currently has a game process up that the user takes part in (a
 * matchmaking or lobby game, not a replay): from the moment a launch is reported until the game
 * has finished or failed. A game that has a result but hasn't exited yet (the score screen) still
 * counts.
 */
export function isInParticipatingGame(state: ReadonlyDeep<GameClientState>): boolean {
  return state.status !== undefined && IN_ACTIVE_GAME_STATES.has(state.status.state)
}

/**
 * Returns whether this client currently has any game process up, whether the user takes part in
 * it or only watches it (a replay), since either keeps the user in the fullscreen game.
 */
export function isInActiveGame(state: ReadonlyDeep<GameClientState>): boolean {
  return isInParticipatingGame(state) || Object.keys(state.watchOnly).length > 0
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@active-game/status'](state, { payload }) {
    if (payload.isReplay) {
      if (IN_ACTIVE_GAME_STATES.has(payload.state)) {
        state.watchOnly[payload.id] = { ...payload }
      } else {
        delete state.watchOnly[payload.id]
      }
    } else {
      state.gameId = payload.id
      state.status = { ...payload }
    }
  },
})
