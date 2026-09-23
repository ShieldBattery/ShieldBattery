import { MapInfoJson } from '../maps'
import { RaceChar } from '../races'
import { SbUserId } from '../users/sb-user-id'
import { GameType } from './game-type'

/** Main-process-generated handoff. All endpoints are private Windows named pipes. */
export interface LocalSessionSetup {
  endpoint: string
  secret: string
  slot: number
  roster: Array<{ slot: number; userId: SbUserId }>
  initialBufferTurns: number
}

/** An explicitly selected, already installed external BWAPI client. */
export interface LocalBotLaunch {
  id: string
  /** The name written to the replay for this bot, if the caller wants it to differ from `name`. */
  replayName?: string
  /** The name shown in the local game. */
  name: string
  race: Exclude<RaceChar, 'r'>
  executable: string
  args?: string[]
  /** Writable bot profile directory, containing any required initial configuration/data. */
  workingDirectory: string
}

/** Does not require an account, a server-created lobby, or an internet connection. */
export interface LocalGameRequest {
  /** Metadata for a map that is already in the app's local map store. */
  map: MapInfoJson
  /**
   * The human. With `observer` set they take an observer seat and watch the bots play each other
   * (which needs at least two bots); `race` is then ignored.
   */
  player: { name: string; race: RaceChar; observer?: boolean }
  bots: LocalBotLaunch[]
  /**
   * Top vs bottom seats the human alone on the top team against every bot; it needs a playing
   * human and is launched as free for all otherwise.
   */
  gameType?: GameType.Melee | GameType.FreeForAll | GameType.TopVsBottom
}

export interface LocalGameStatus {
  id: string
  state: 'launching' | 'playing' | 'stopping' | 'finished' | 'error'
  playerGameId: string
  botGameIds: string[]
  error?: string
}
