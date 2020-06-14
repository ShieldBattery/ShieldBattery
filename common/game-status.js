// These constants represent the status of a game in both shieldbattery and psi
// Their values must be unique, and they are considered "ordered" (that is, a higher number means
// a later state). They do not need to be preserved across versions though, they just need to be
// the same between psi and shieldbattery in the same version.

export const GAME_STATUS_UNKNOWN = 0
export const GAME_STATUS_LAUNCHING = 1
export const GAME_STATUS_CONFIGURING = 2
export const GAME_STATUS_AWAITING_PLAYERS = 3
export const GAME_STATUS_STARTING = 4
export const GAME_STATUS_PLAYING = 5
export const GAME_STATUS_FINISHED = 6
export const GAME_STATUS_ERROR = 7

export function statusToString(status) {
  switch (status) {
    case GAME_STATUS_UNKNOWN:
      return 'unknown'
    case GAME_STATUS_LAUNCHING:
      return 'launching'
    case GAME_STATUS_CONFIGURING:
      return 'configuring'
    case GAME_STATUS_AWAITING_PLAYERS:
      return 'awaitingPlayers'
    case GAME_STATUS_STARTING:
      return 'starting'
    case GAME_STATUS_PLAYING:
      return 'playing'
    case GAME_STATUS_FINISHED:
      return 'finished'
    case GAME_STATUS_ERROR:
      return 'error'
    default:
      return 'invalid'
  }
}

export function stringToStatus(string) {
  switch (string) {
    case 'unknown':
      return GAME_STATUS_UNKNOWN
    case 'launching':
      return GAME_STATUS_LAUNCHING
    case 'configuring':
      return GAME_STATUS_CONFIGURING
    case 'awaitingPlayers':
      return GAME_STATUS_AWAITING_PLAYERS
    case 'starting':
      return GAME_STATUS_STARTING
    case 'playing':
      return GAME_STATUS_PLAYING
    case 'finished':
      return GAME_STATUS_FINISHED
    case 'error':
      return GAME_STATUS_ERROR
    default:
      return -1
  }
}
