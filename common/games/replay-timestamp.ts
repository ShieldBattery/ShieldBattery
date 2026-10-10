/**
 * Game time per simulation frame. The in-game clock and a game's recorded length both count
 * frames at this rate, regardless of the speed the game was played or is being watched at.
 */
export const MS_PER_GAME_FRAME = 42

/** Name of the query parameter that holds the time a link into a game's replay starts at. */
export const REPLAY_TIMESTAMP_PARAM = 't'

/**
 * The longest timestamp a link can carry. A game this long would be cut off long before it, so
 * anything past it is a malformed link rather than a real time.
 */
const MAX_TIMESTAMP_SECONDS = 24 * 60 * 60

const SECONDS_PATTERN = /^(\d+)s?$/
const UNITS_PATTERN = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/
const CLOCK_PATTERN = /^(?:(\d+):)?(\d+):(\d{2})$/

/**
 * Parses the game time a replay link starts at, in whole seconds. Accepts plain seconds (`754`,
 * `754s`), unit form (`12m34s`, `1h2m3s`), and clock form (`12:34`, `1:02:03`). Returns
 * `undefined` for anything else, including a time of zero, which is just the start of the replay.
 */
export function parseReplayTimestamp(value: string | null | undefined): number | undefined {
  if (!value) {
    return undefined
  }

  let seconds: number
  const plain = SECONDS_PATTERN.exec(value)
  const units = plain ? undefined : UNITS_PATTERN.exec(value)
  const clock = plain || units ? undefined : CLOCK_PATTERN.exec(value)
  if (plain) {
    seconds = Number(plain[1])
  } else if (units && (units[1] || units[2] || units[3])) {
    seconds = Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0)
  } else if (clock) {
    seconds = Number(clock[1] ?? 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3])
  } else {
    return undefined
  }

  return seconds > 0 && seconds <= MAX_TIMESTAMP_SECONDS ? seconds : undefined
}

/** Formats a time in seconds the way links carry it, e.g. `12m34s`. */
export function formatReplayTimestamp(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor(whole / 60) % 60
  const secs = whole % 60
  return (hours ? `${hours}h` : '') + (hours || minutes ? `${minutes}m` : '') + `${secs}s`
}

/** The simulation frame the in-game clock reaches the given time on. */
export function replayFrameForSeconds(seconds: number): number {
  return Math.round((seconds * 1000) / MS_PER_GAME_FRAME)
}
