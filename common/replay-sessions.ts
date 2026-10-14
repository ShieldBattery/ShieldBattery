import { RaceChar } from './races'

/** Someone who played in a replay, as its header records them. */
export interface ReplaySessionPlayer {
  name: string
  race: RaceChar
  team: number
}

/** Metadata for a replay that can be watched with others. */
export interface ReplaySessionSourceMetadata {
  mapName: string
  gameType: string
  durationFrames: number
  /** Everyone who played in the replay (not its observers), in slot order. */
  players: ReplaySessionPlayer[]
}

/**
 * The response from staging a local replay for a future multiplayer replay session.
 *
 * `sourceId` is only useful to the owner while it remains unexpired. It is intentionally not a
 * download capability: the staged object's storage path and URL never leave the server here.
 */
export interface StageReplaySessionSourceResponse {
  sourceId: string
  hash: string
  size: number
  metadata: ReplaySessionSourceMetadata
}

/**
 * The replay a host asks to watch with others: the best replay stored for a ShieldBattery game, or
 * a local replay the host staged through the sources endpoint.
 */
export type ReplaySessionSource =
  | { kind: 'game'; gameId: string }
  | { kind: 'upload'; sourceId: string }

/**
 * What everyone watching may know about a replay. An uploaded source's id is its owner's alone,
 * so it is never part of this.
 */
export type ReplaySessionSourceInfo =
  | { kind: 'game'; gameId: string; metadata: ReplaySessionSourceMetadata }
  | { kind: 'upload'; metadata: ReplaySessionSourceMetadata }

/**
 * A short-lived capability for one viewer to download a replay. Clients must check the downloaded
 * bytes against `hash` before loading them.
 */
export interface GetReplaySessionSourceResponse {
  url: string
  hash: string
  size: number
}

/** A native replay speed command, including the pause bit carried by every speed change. */
export interface ReplaySessionSpeed {
  paused: boolean
  speed: number
  multiplier: number
}

/** One coordinated seek of every viewer in a replay lobby. */
export interface ReplaySessionSeek {
  epoch: number
  frame: number
}
