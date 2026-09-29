import type { GameType } from '@shieldbattery/broodrep'
import { TFunction } from 'i18next'
import { SbUserId } from './users/sb-user-id'

export enum SupportedReplayGameType {
  Melee = 2,
  FreeForAll = 3,
  OneVsOne = 4,
  CaptureTheFlag = 5,
  Greed = 6,
  Slaughter = 7,
  SuddenDeath = 8,
  UseMapSettings = 10,
  TeamMelee = 11,
  TeamFreeForAll = 12,
  TeamCaptureTheFlag = 13,
  TopVsBottom = 15,
}

/**
 * The game types offered as standalone options in the replay Mode filter. Anything else is
 * grouped under the filter's "Others" option.
 */
export const FEATURED_REPLAY_GAME_TYPES: ReadonlyArray<SupportedReplayGameType> = [
  SupportedReplayGameType.Melee,
  SupportedReplayGameType.FreeForAll,
  SupportedReplayGameType.OneVsOne,
  SupportedReplayGameType.UseMapSettings,
  SupportedReplayGameType.TopVsBottom,
]

export function replayGameTypeToLabel(gameType: SupportedReplayGameType, t: TFunction): string {
  switch (gameType) {
    case SupportedReplayGameType.Melee:
      return t('game.gameType.melee', 'Melee')
    case SupportedReplayGameType.FreeForAll:
      return t('game.gameType.freeForAll', 'Free for all')
    case SupportedReplayGameType.OneVsOne:
      return t('game.gameType.oneOnOne', 'One on one')
    case SupportedReplayGameType.CaptureTheFlag:
      return t('game.gameType.captureTheFlag', 'Capture the flag')
    case SupportedReplayGameType.Greed:
      return t('game.gameType.greed', 'Greed')
    case SupportedReplayGameType.Slaughter:
      return t('game.gameType.slaughter', 'Slaughter')
    case SupportedReplayGameType.SuddenDeath:
      return t('game.gameType.suddenDeath', 'Sudden death')
    case SupportedReplayGameType.UseMapSettings:
      return t('game.gameType.useMapSettings', 'Use map settings')
    case SupportedReplayGameType.TeamMelee:
      return t('game.gameType.teamMelee', 'Team melee')
    case SupportedReplayGameType.TeamFreeForAll:
      return t('game.gameType.teamFreeForAll', 'Team free for all')
    case SupportedReplayGameType.TeamCaptureTheFlag:
      return t('game.gameType.teamCaptureTheFlag', 'Team capture the flag')
    case SupportedReplayGameType.TopVsBottom:
      return t('game.gameType.topVsBottom', 'Top vs bottom')
    default:
      return t('game.gameType.unknown', 'Unknown')
  }
}

/**
 * Maps broodrep's named `GameType` to the numeric game type stored in the replay index, per
 * broodrep's own `From<u16>` implementation.
 */
export const replayGameTypeToNumber: Record<GameType, number> = {
  none: 0,
  melee: 2,
  freeForAll: 3,
  oneOnOne: 4,
  captureTheFlag: 5,
  greed: 6,
  slaughter: 7,
  suddenDeath: 8,
  ladder: 9,
  useMapSettings: 10,
  teamMelee: 11,
  teamFreeForAll: 12,
  teamCaptureTheFlag: 13,
  topVsBottom: 15,
  unknown: 0,
}

// TODO(2Pac): Share this with the game code somehow?
/**
 * This is the value that's inserted in the `userIds` array of the ShieldBattery's replay data, for
 * every non-human slot.
 */
export const NON_EXISTING_USER_ID = 0xffffffff

/** A chat message recorded in a replay's command stream. */
export interface ReplayChatMessage {
  frame: number
  /**
   * The sender's game player id: their `players[]` slot for a player, or 128-131 for an observer.
   * Matches `ReplayChatPlayer.slotId`.
   */
  senderSlot: number
  text: string
}

/** A player leaving the game, as recorded in a replay's command stream. */
export interface ReplayLeave {
  frame: number
  /** The leaving player's slot. Matches `ReplayChatPlayer.slotId`. */
  slotId: number
  /** Whether the player was dropped (stopped responding) rather than leaving deliberately. */
  dropped: boolean
}

export interface ReplayChatPlayer {
  slotId: number
  name: string
  isObserver: boolean
  /** The player's ShieldBattery user id, if the replay's ShieldBattery section records one. */
  userId?: SbUserId
  /** The player's in-game color as a `#rrggbb` string, if the replay records one for their slot. */
  color?: string
}

/**
 * The chat recorded in a single replay. A replay holds only the chat its recording player saw (what
 * they sent plus what was sent to them), so different players' replays of the same game can hold
 * different messages.
 */
export interface ReplayChat {
  /** The replay's length in frames. */
  frames: number
  players: ReplayChatPlayer[]
  /** The chat messages, in the order they were recorded. */
  messages: ReplayChatMessage[]
  /**
   * The players who left while the replay was recording, in the order they left. Never includes
   * the recording player, whose leaving ends the replay.
   */
  leaves: ReplayLeave[]
}
