import { atom } from 'jotai'
import { atomWithImmer } from 'jotai-immer'
import { GameLoadingStatus } from '../../common/games/game-loader-network'

export interface LastGameState {
  /**
   * The ID of the last game that was played in this client (if any). As of the time of writing,
   * this is intended to be used to determine when to show updates to the user for game state that
   * can change some time after the game has concluded for the user (such as matchmaking rating
   * changes). As such, it should not be updated for things like watching replays.
   */
  id?: string
}

/** Info about the last game that was played in this client. */
export const lastGameAtom = atom<LastGameState | undefined>(undefined)

const MAX_RECENT_REPLAY_PATHS = 8

/**
 * Paths to the replay files saved for games recently played in this client, keyed by game ID. A
 * game's replay is saved (and its path reported) some time after the game completes, so UIs for a
 * completed game (e.g. the post-match dialog) should subscribe to this atom to pick up the path
 * whenever it arrives, rather than capturing its presence/absence once.
 */
export const recentReplayPathsAtom = atomWithImmer<ReadonlyMap<string, string>>(new Map())

/** Records the path of a saved replay, evicting the oldest recorded path if full. */
export const addRecentReplayPathAtom = atom(
  null,
  (_get, set, { gameId, path }: { gameId: string; path: string }) => {
    set(recentReplayPathsAtom, draft => {
      draft.delete(gameId)
      draft.set(gameId, path)
      if (draft.size > MAX_RECENT_REPLAY_PATHS) {
        draft.delete(draft.keys().next().value!)
      }
    })
  },
)

/** An intermediate status the loading UI shows for a game still coming up. */
export interface GameLoadingStatusState {
  gameId: string
  status: GameLoadingStatus
}

/**
 * The current game load's intermediate status (e.g. a game server still being provisioned), or
 * `undefined` when there's nothing extra to surface. Set while a load reports a slow step and
 * cleared once the load resolves, fails, or the session handoff arrives.
 */
export const gameLoadingStatusAtom = atom<GameLoadingStatusState | undefined>(undefined)
