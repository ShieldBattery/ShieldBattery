import { isHiddenUmsSlot } from './lobbies'
import { MapInfoKind, SbMapId } from './maps'
import { RaceChar } from './races'

/** The body of a request to launch a game on a map alone (`POST /solo-games`). */
export interface LaunchSoloGameRequest {
  /** The app client that will run the game. */
  clientId: string
  map: SbMapId
  /**
   * The map's player slot to play from (the `id` of one of its force players, which must be a
   * human slot). Defaults to the map's first human slot, in force order.
   */
  slot?: number
  /**
   * The race to play. Only a slot whose race the map leaves free can take one other than the
   * map's; defaults to the map's race for the slot, or random when it leaves it free.
   */
  race?: RaceChar
}

export enum SoloGameServiceErrorCode {
  /** The named client isn't connected, or isn't an app client (only the app can run a game). */
  NoActiveClient = 'noActiveClient',
  MapNotFound = 'mapNotFound',
  /** The map isn't one that can be played alone (see `canPlayMapAlone`). */
  MapNotPlayableAlone = 'mapNotPlayableAlone',
  /** The slot isn't one of the map's human slots. */
  InvalidSlot = 'invalidSlot',
  /** The slot's race is fixed by the map, and a different one was asked for. */
  InvalidRace = 'invalidRace',
  /** The user is already in a lobby, the matchmaking queue, or launching another game. */
  AlreadyInActivity = 'alreadyInActivity',
  /** The user is already playing a game. */
  AlreadyInGame = 'alreadyInGame',
}

/** Why a solo game that began loading didn't start. */
export enum SoloGameLaunchFailure {
  /**
   * The game didn't finish loading in time, which is also how a launch whose client went away and
   * never started the game ends.
   */
  Timeout = 'timeout',
  /** The client reported that the game failed to load. */
  ClientFailed = 'clientFailed',
  /** Something went wrong on the server. */
  Internal = 'internal',
}

/** The game finished loading and is being played. */
export interface SoloGameStartedEvent {
  type: 'gameStarted'
  gameId: string
}

/** The game that began loading didn't start. */
export interface SoloGameLaunchFailedEvent {
  type: 'launchFailed'
  reason: SoloGameLaunchFailure
}

/**
 * How a launch that the server accepted turned out, sent to the launching client on
 * `/solo-games/:userId` once the load settles. Only the client that launched is subscribed to that
 * path, and only for the duration of the load: if it disconnected meanwhile, the load goes on
 * without it and a client that reconnects isn't told how it turned out.
 */
export type SoloGameEvent = SoloGameStartedEvent | SoloGameLaunchFailedEvent

/** As much of a map's force players as deciding whether it can be played alone needs. */
export interface SoloGameForce {
  readonly players: ReadonlyArray<{ readonly computer: boolean; readonly typeId: number }>
}

/**
 * Whether a map can be played by one person alone: it's a UMS map, it has a slot for a human to
 * play from, and it has a computer to play against. These are the maps a lobby with only its host
 * could start a Use Map Settings game on.
 */
export function canPlayMapAlone(kind: MapInfoKind, forces: ReadonlyArray<SoloGameForce>): boolean {
  const players = forces.flatMap(force => force.players)
  return (
    kind === 'ums' &&
    players.some(p => !p.computer) &&
    players.some(p => p.computer && !isHiddenUmsSlot(p))
  )
}
