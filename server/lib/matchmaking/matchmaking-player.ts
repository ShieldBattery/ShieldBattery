import { AssignedRaceChar, RaceChar } from '../../../common/races'
import { NEW_PLAYER_GAME_COUNT } from './constants'

export interface MatchmakingInterval {
  low: number
  high: number
}

export interface MatchmakingPlayer {
  /** The user's ID number (from the `users` table). */
  id: number
  /** The user's name. */
  name: string
  /** How many games this user has played (in the current MMR section). */
  numGamesPlayed: number
  /** The user's current MMR. */
  rating: number
  /**
   * The current search interval for matchmaking, i.e. the lowest and highest rating that would be
   * considered a valid match.
   */
  interval: MatchmakingInterval
  /**
   * The number of search iterations this user has gone through (should be initialized to 0, will
   * be updated by the matchmaker).
   */
  searchIterations: number
  /** The race the user wants to play. */
  race: RaceChar
  /** Whether the user wants to use an alternate race if the match is a mirror. */
  useAlternateRace: boolean
  /**
   * The race to use in the event of a mirror matchup (provided `useAlternateRace` is `true`).
   */
  alternateRace: AssignedRaceChar
  /**
   * A list of maps that this player has selected when queueing for a match. Its meaning depends on
   * the matchmaking type and the system it's using. E.g. 1v1/2v2 might use this list as maps the
   * user has vetoed, while in 3v3 it might be used as as a list of maps that the user wants to
   * queue on.
   */
  mapSelections: Set<string>

  /**
   * The values the search interval was started with. This should be `undefined` initially, the
   * matchmaker will initialize the correct values.
   */
  startingInterval?: MatchmakingInterval
  /**
   * The maximum values the search interval will be increased to. This should be `undefined`
   * initially, the matchmaker will initialize the correct values.
   */
  maxInterval?: MatchmakingInterval
}

export function isNewPlayer(player: MatchmakingPlayer) {
  return player.numGamesPlayed >= NEW_PLAYER_GAME_COUNT
}
