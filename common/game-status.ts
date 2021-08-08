import { assertUnreachable } from './assert-unreachable'

/**
 * Represents the status of a game in progress. These are considered "ordered" (that is, a higher
 * number means a later state). Their values/existence do not need to be preserved across versions,
 * as these values are transient and not stored across application launches. Note that they *are*
 * passed to the server in some cases (but not stored in the DB), so they should match between the
 * server and client for a particular version.
 */
export enum GameStatus {
  Unknown = 0,
  Launching,
  Configuring,
  AwaitingPlayers,
  Starting,
  Playing,
  HasResult,
  ResultSent,
  Finished,
  // This constant is being duplicated in game-side code game/src/app_messages.rs
  // They should be kept in sync if this ever needs to changed.
  Error = 666,
}

export function statusToString(status: GameStatus) {
  switch (status) {
    case GameStatus.Unknown:
      return 'unknown'
    case GameStatus.Launching:
      return 'launching'
    case GameStatus.Configuring:
      return 'configuring'
    case GameStatus.AwaitingPlayers:
      return 'awaitingPlayers'
    case GameStatus.Starting:
      return 'starting'
    case GameStatus.Playing:
      return 'playing'
    case GameStatus.HasResult:
      return 'hasResult'
    case GameStatus.ResultSent:
      return 'resultSent'
    case GameStatus.Finished:
      return 'finished'
    case GameStatus.Error:
      return 'error'
    default:
      return assertUnreachable(status)
  }
}

export function stringToStatus(str: ReturnType<typeof statusToString>) {
  switch (str) {
    case 'unknown':
      return GameStatus.Unknown
    case 'launching':
      return GameStatus.Launching
    case 'configuring':
      return GameStatus.Configuring
    case 'awaitingPlayers':
      return GameStatus.AwaitingPlayers
    case 'starting':
      return GameStatus.Starting
    case 'playing':
      return GameStatus.Playing
    case 'hasResult':
      return GameStatus.HasResult
    case 'resultSent':
      return GameStatus.ResultSent
    case 'finished':
      return GameStatus.Finished
    case 'error':
      return GameStatus.Error
    default:
      return assertUnreachable(str)
  }
}
