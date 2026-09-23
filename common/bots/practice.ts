/**
 * Local bot practice: the setup the user builds (map pool, opponent lineup, presets), the record of
 * games played, and the launch request the renderer sends. All of this is stored on the user's PC
 * and never reported to the server.
 */

import { GameType } from '../games/game-type'
import { MapInfoJson, SbMapId } from '../maps'
import { MatchmakingType } from '../matchmaking'
import { RaceChar } from '../races'
import { BotRaceName } from './bot-catalog'
import { BotKey, PracticeBotSelection } from './bot-library'

/**
 * A bot saved in a lineup or a game slot. Only the bot is saved, so a lineup always runs whatever
 * version is installed; `name`/`version` let a bot that is no longer installed stay visible.
 */
export interface PracticeBotRef {
  key: BotKey
  name: string
  version: string
}

export interface OpponentPreset {
  id: string
  name: string
  bots: PracticeBotRef[]
  createdAt: number
  updatedAt: number
}

export interface MapPoolPreset {
  id: string
  name: string
  mapIds: SbMapId[]
  createdAt: number
  updatedAt: number
}

export type MapPoolSource =
  | { kind: 'ladder'; matchmakingType: MatchmakingType }
  | { kind: 'preset'; presetId: string }
  | { kind: 'custom' }

/** The last downloaded official pool, kept so practice works offline. */
export interface CachedLadderMapPool {
  matchmakingType: MatchmakingType
  poolId: number
  fetchedAt: number
  startDate: number
  mapIds: SbMapId[]
}

export interface PracticeMatchmakingSetup {
  mapPool: MapPoolSource
  /** The maps chosen when `mapPool.kind` is `custom`. */
  customMapIds: SbMapId[]
  /**
   * An in-progress edit of a saved pool's maps. The pool itself only changes when the edit is
   * saved, so switching pools or leaving the page loses nothing.
   */
  presetEdit?: { presetId: string; mapIds: SbMapId[] }
  /**
   * Maps the player has turned off while using the ladder pool or a saved preset (a custom pool
   * is edited directly instead). Ids outside the current pool are ignored, and a pool always
   * keeps at least one map in play, so a veto set that covers everything is disregarded.
   */
  vetoMapIds: SbMapId[]
  lineup: PracticeBotRef[]
  /** The opponent preset the lineup was loaded from, if any. */
  lineupPresetId?: string
  playerRace: RaceChar
  /** Whether the drawn opponent's identity is concealed until the game ends. */
  hideOpponent: boolean
  /** Whether the "some opponents aren't ready" warning has been suppressed. */
  skipPartialLineupWarning: boolean
}

export interface CustomGameBotSlot {
  bot: PracticeBotRef
  race: BotRaceName
}

export interface CustomGameSetup {
  /**
   * "You vs all bots" is top vs bottom with the human alone on top. Melee is what setups saved
   * before that option existed hold; it launches as top vs bottom (see `customGameType`).
   */
  gameType: GameType.TopVsBottom | GameType.FreeForAll | GameType.Melee
  mapId?: SbMapId
  /** The human's race is `PracticeMatchmakingSetup.playerRace`, shared with practice matchmaking. */
  slots: CustomGameBotSlot[]
  /** Watch the bots play each other from an observer seat instead of taking a slot. */
  observe?: boolean
}

export type PracticeGameMode = 'matchmaking' | 'custom'

export interface PracticeGameOpponent {
  key: BotKey
  releaseId?: string
  name: string
  version: string
  race: BotRaceName
}

/**
 * A game played through practice. Kept locally so a hidden opponent can be revealed after the game
 * and so the saved replay can be attributed to the real bot.
 */
export interface PracticeGameRecord {
  sessionId: string
  playerGameId: string
  mode: PracticeGameMode
  startedAt: number
  hidden: boolean
  mapId: SbMapId
  mapName: string
  playerRace: RaceChar
  opponents: PracticeGameOpponent[]
  /** The human watched from an observer seat; `playerRace` and `result` say nothing then. */
  observed?: boolean
  /**
   * The game type the game launched with, so a rematch replays it even if the custom setup has
   * changed since. Records written without it rematch with the current setup's type.
   */
  gameType?: GameType.TopVsBottom | GameType.FreeForAll | GameType.Melee
  /**
   * Indices into `opponents` of the bots the game reported as winners, once it has ended. Indices
   * rather than names, since the same bot can fill several slots.
   */
  winnerIndices?: number[]
  result?: 'victory' | 'defeat' | 'unknown'
  /** Game duration reported by the client. */
  timeMs?: number
  replayPath?: string
}

export const PRACTICE_STORE_VERSION = 1

export const MAX_PRACTICE_HISTORY = 50
export const MAX_RECENT_PRACTICE_MAPS = 8

export interface PracticeStoreData {
  version: typeof PRACTICE_STORE_VERSION
  matchmaking: PracticeMatchmakingSetup
  customGame: CustomGameSetup
  opponentPresets: OpponentPreset[]
  mapPoolPresets: MapPoolPreset[]
  cachedLadderPool?: CachedLadderMapPool
  /** Maps picked for custom games, most recent first. */
  recentMapIds: SbMapId[]
  /** Every map referenced by the setup, presets or history, so they are usable offline. */
  knownMaps: Record<SbMapId, MapInfoJson>
  history: PracticeGameRecord[]
}

export function createDefaultPracticeStore(): PracticeStoreData {
  return {
    version: PRACTICE_STORE_VERSION,
    matchmaking: {
      mapPool: { kind: 'ladder', matchmakingType: MatchmakingType.Match1v1 },
      customMapIds: [],
      vetoMapIds: [],
      lineup: [],
      playerRace: 'r',
      hideOpponent: true,
      skipPartialLineupWarning: false,
    },
    customGame: {
      gameType: GameType.TopVsBottom,
      slots: [],
    },
    opponentPresets: [],
    mapPoolPresets: [],
    recentMapIds: [],
    knownMaps: {},
    history: [],
  }
}

/** The in-game name used for a concealed practice opponent. */
export const HIDDEN_OPPONENT_NAME = 'Practice bot'

/** What the renderer sends to start a practice game; paths are resolved by the main process. */
export interface PracticeLaunchRequest {
  map: MapInfoJson
  player: { name: string; race: RaceChar; observer?: boolean }
  gameType: GameType.TopVsBottom | GameType.FreeForAll | GameType.Melee
  bots: PracticeBotSelection[]
}

/**
 * The game type a custom setup launches with. Top vs bottom puts the human alone on the top team,
 * which has no meaning when the human only watches, so a watched game is always free for all.
 */
export function customGameType(
  setup: Pick<CustomGameSetup, 'gameType' | 'observe'>,
): GameType.TopVsBottom | GameType.FreeForAll {
  if (setup.observe || setup.gameType === GameType.FreeForAll) {
    return GameType.FreeForAll
  }
  return GameType.TopVsBottom
}

/** A game has eight player slots; a playing human takes one of them, a watching human none. */
export const MAX_GAME_PLAYER_SLOTS = 8

/**
 * How many bots the setup can seat on a map with `mapSlots` player slots: every slot when the
 * human only watches, all but one otherwise. Without a map, only the game's own limit applies.
 */
export function customGameBotCapacity(
  setup: Pick<CustomGameSetup, 'observe'>,
  mapSlots: number | undefined,
): number {
  const slots = Math.min(MAX_GAME_PLAYER_SLOTS, mapSlots ?? MAX_GAME_PLAYER_SLOTS)
  return Math.max(0, setup.observe ? slots : slots - 1)
}
