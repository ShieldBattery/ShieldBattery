import { ReadonlyDeep } from 'type-fest'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface LastGameState {
  /**
   * The ID of the last game that was played in this client (if any). As of the time of writing,
   * this is intended to be used to determine when to show updates to the user for game state that
   * can change some time after the game has concluded for the user (such as matchmaking rating
   * changes). As such, it should not be updated for things like watching replays.
   */
  id?: string
  /** A path to the replay file saved for the last game, if it is known. */
  replayPath?: string
}

const DEFAULT_STATE: ReadonlyDeep<LastGameState> = {
  id: undefined,
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@active-game/status'](state, { payload }) {
    if (!payload.isReplay && payload.state === 'playing') {
      return {
        id: payload.id,
      }
    }

    return state
  },

  ['@active-game/replaySaved'](state, { payload: { gameId, path } }) {
    if (state.id === gameId) {
      state.replayPath = path
    }
  },

  ['@matchmaking/matchFound']() {
    // When a match is found, we clear out this state so that we don't e.g. show the user a dialog
    // about their previous match that prevents them from accepting the new match.
    return DEFAULT_STATE
  },

  // TODO(tec27): Might want some way to clear this state outside of launching another game? Like
  // when a "rank update" dialog is closed?
})
