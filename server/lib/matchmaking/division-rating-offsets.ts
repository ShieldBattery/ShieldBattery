import {
  ALL_MATCHMAKING_TYPES,
  DivisionRatingOffsets,
  hasDivisionRatingOffset,
  MatchmakingType,
} from '../../../common/matchmaking'

/**
 * How many games a user must have played in both the reference mode and another mode for their
 * ratings to count towards that mode's division rating offset. Ratings with fewer games behind them
 * haven't settled enough to say anything about the gap between the modes.
 */
export const DIVISION_RATING_OFFSET_MIN_LIFETIME_GAMES = 20
/** How many qualifying users a mode needs before its division rating offset is applied. */
export const DIVISION_RATING_OFFSET_MIN_USERS = 30
/**
 * The smallest division rating offset that is applied. Smaller gaps between modes are within the
 * noise of the comparison and are left alone.
 */
export const DIVISION_RATING_OFFSET_MIN_OFFSET = 50

/** The matchmaking types that get a division rating offset computed for them. */
export const OFFSET_MATCHMAKING_TYPES: ReadonlyArray<MatchmakingType> =
  ALL_MATCHMAKING_TYPES.filter(hasDivisionRatingOffset)

function median(values: ReadonlyArray<number>): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

/**
 * Computes a mode's division rating offset from the differences between qualifying users' ratings
 * in the reference mode and in that mode (reference minus mode): their median, rounded to a whole
 * number, if there are enough users and the median is large enough, otherwise 0.
 */
export function computeDivisionRatingOffset(differences: ReadonlyArray<number>): number {
  if (differences.length < DIVISION_RATING_OFFSET_MIN_USERS) {
    return 0
  }
  const offset = median(differences)
  return offset >= DIVISION_RATING_OFFSET_MIN_OFFSET ? Math.round(offset) : 0
}

/**
 * Computes the division rating offset of every mode that can have one, given the rating differences
 * for each (see `computeDivisionRatingOffset`). Modes without any differences get an offset of 0.
 */
export function computeDivisionRatingOffsets(
  differencesByType: ReadonlyMap<MatchmakingType, ReadonlyArray<number>>,
): DivisionRatingOffsets {
  return Object.fromEntries(
    OFFSET_MATCHMAKING_TYPES.map(type => [
      type,
      computeDivisionRatingOffset(differencesByType.get(type) ?? []),
    ]),
  )
}
