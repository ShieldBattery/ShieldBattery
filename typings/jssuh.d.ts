// TODO(tec27): Make proper types for jssuh (and include them in the module ideally)
declare module 'jssuh' {
  import { Transform } from 'stream'

  export type ReplayRace = 'protoss' | 'terran' | 'zerg' | 'unknown'

  export interface ReplayPlayer {
    name: string
    id: number
    race: ReplayRace
    team: number
    isComputer: boolean
  }

  export interface ReplayHeader {
    /** The name of the lobby. */
    gameName: string
    /** The map title. */
    mapName: string
    /** Game type (melee, ums, etc). Currently just exposed as a integer. */
    gameType: number
    /** Game type modifier (Top vs bottom team layout, greed victory conditions, etc). */
    gameSubtype: number
    /** Array of players in the game. */
    players: ReplayPlayer[]
    /** The duration of the game, in frames (1 / 24th of a second on fastest speed). */
    durationFrames: number
    /** Initial random seed, which is also the timestamp of the replay. */
    seed: number
    /** True if the replay uses StarCraft Remastered format, false for older replays. */
    remastered: boolean
  }

  export default class ReplayParser extends Transform {
    rawScrSection(tag: string, callback: (bytes: Buffer) => void): void
  }
}
