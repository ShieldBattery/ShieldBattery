import { atom } from 'jotai'
import { GameServerRegionId } from '../../common/game-server-regions'
import { GameLoadingStatus } from '../../common/games/game-loader-network'

export interface LastGameState {
  /**
   * The ID of the last game that was played in this client (if any). As of the time of writing,
   * this is intended to be used to determine when to show updates to the user for game state that
   * can change some time after the game has concluded for the user (such as matchmaking rating
   * changes). As such, it should not be updated for things like watching replays.
   */
  id?: string
  // TODO(tec27): We should store a list of recent game IDs => replay path instetad, so that the
  // post-match dialog can look up the replay path for a game and update if it updates
  /** A path to the replay file saved for the last game, if it is known. */
  replayPath?: string
}

/** Info about the last game that was played in this client. */
export const lastGameAtom = atom<LastGameState | undefined>(undefined)

/** An intermediate status the loading UI shows for a game still coming up. */
export interface GameLoadingStatusState {
  gameId: string
  status: GameLoadingStatus
  regions: GameServerRegionId[]
}

/**
 * The current game load's intermediate status (e.g. a game server still being provisioned), or
 * `undefined` when there's nothing extra to surface. Set while a load reports a slow step and
 * cleared once the load resolves, fails, or the session handoff arrives.
 */
export const gameLoadingStatusAtom = atom<GameLoadingStatusState | undefined>(undefined)
