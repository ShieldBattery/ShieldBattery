import { AssignedRaceChar, RaceChar } from '../../../common/races'

export interface MatchmakingPlayer {
  /** The user's ID number (from the `users` table). */
  id: number
  /** The user's name. */
  name: string
  /** The user's current MMR. */
  rating: number
  /**
   * The current search interval for matchmaking, i.e. the lowest and highest rating that would be
   * considered a valid match.
   */
  interval: {
    low: number
    high: number
  }
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
   * A list of maps that this player prefers to play on, which will have their probability boosted
   * versus the rest of the map pool.
   */
  preferredMaps: Set<string>
}
