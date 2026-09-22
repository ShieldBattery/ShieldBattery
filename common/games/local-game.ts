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
  player: { name: string; race: RaceChar }
  bots: LocalBotLaunch[]
  gameType?: GameType.Melee | GameType.FreeForAll
}

export interface LocalGameStatus {
  id: string
  state: 'launching' | 'playing' | 'stopping' | 'finished' | 'error'
  playerGameId: string
  botGameIds: string[]
  error?: string
}
