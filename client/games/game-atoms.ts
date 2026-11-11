import { atom } from 'jotai'
import { atomWithImmer } from 'jotai-immer'
import { PlayerInfo } from '../../common/games/game-launch-config'
import { GameLoadingStatus } from '../../common/games/game-loader-network'
import { GameType } from '../../common/games/game-type'
import { MatchmakingType } from '../../common/matchmaking'

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

/**
 * Games whose replay is on its way to being watched (downloading, or being handed to StarCraft).
 * Shared by every surface that offers watching a game, so pressing watch again anywhere while the
 * first press is still underway can't start a second replay, which would quit and relaunch
 * StarCraft (or run two of it, when replays are kept alongside games).
 */
export const startingReplayGameIdsAtom = atom<ReadonlySet<string>>(new Set<string>())

/** What the client knows about the game the user takes part in (a lobby or matchmaking game). */
export interface ParticipatingGameInfo {
  gameId: string
  gameType: GameType
  mapName: string
  /** The URL of the map's image, if it has one. */
  mapImageUrl?: string
  /** The match's matchmaking type, or `undefined` for a lobby game. */
  matchmakingType?: MatchmakingType
  slots: ReadonlyArray<Pick<PlayerInfo, 'userId' | 'race' | 'type'>>
  /** When this client saw the game reach `playing`, in milliseconds since the Unix epoch. */
  playingSince?: number
}

/** The game the user last took part in, from when its setup arrives. */
export const participatingGameAtom = atom<ParticipatingGameInfo | undefined>(undefined)

/** What the client knows about a replay it started. */
export interface WatchedReplayInfo {
  /** The game ID of the replay's playback. */
  gameId: string
  /** The map the replay was played on, if its header could be read. */
  mapName?: string
}

/** The replay this client started most recently, from when its playback is set up. */
export const watchedReplayAtom = atom<WatchedReplayInfo | undefined>(undefined)

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
