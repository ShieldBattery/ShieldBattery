import { LadderPlayer } from '../../common/ladder/ladder'
import { MatchmakingDivision, NUM_PLACEMENT_MATCHES } from '../../common/matchmaking'

/** Bucket widths to pick from, smallest first. Each is a round number of rating. */
const BUCKET_WIDTHS: ReadonlyArray<number> = [10, 20, 25, 50, 100, 200, 250, 500]
/** The most buckets a distribution is split into before it moves up to a wider bucket. */
const MAX_BUCKETS = 50

export interface RatingBucket {
  /** The lowest rating in this bucket (inclusive). */
  start: number
  /** The highest rating in this bucket (exclusive). */
  end: number
  /** How many rated players have a rating in this bucket. */
  count: number
  /**
   * How many rated players have a rating at or above `start`, i.e. what a player at the bottom of
   * this bucket is in the top of.
   */
  atOrAbove: number
  /**
   * The division most of this bucket's players are in, or `Unrated` for an empty bucket. Ties go to
   * the higher division.
   */
  division: MatchmakingDivision
}

export interface RatingDistribution {
  buckets: RatingBucket[]
  bucketWidth: number
  /** How many players are included, i.e. those who have finished their placement matches. */
  ratedCount: number
  /** The median rating of the included players, or `undefined` if there are none. */
  median: number | undefined
  /** Every included rating, sorted ascending. */
  sortedRatings: number[]
}

type DistributionPlayer = Pick<LadderPlayer, 'rating' | 'lifetimeGames'>

/**
 * Whether a player's rating is shown. The server reports a rating of 0 for players still in their
 * placement matches, so counting those would pile them all into a bucket at 0.
 */
export function hasVisibleRating(player: Readonly<DistributionPlayer>): boolean {
  return (
    player.lifetimeGames >= NUM_PLACEMENT_MATCHES &&
    Number.isFinite(player.rating) &&
    player.rating > 0
  )
}

/** Picks the narrowest bucket width that splits `range` into at most `MAX_BUCKETS` buckets. */
export function pickBucketWidth(range: number): number {
  return (
    BUCKET_WIDTHS.find(width => range / width <= MAX_BUCKETS) ??
    BUCKET_WIDTHS[BUCKET_WIDTHS.length - 1]
  )
}

/**
 * Splits the rated players into equal-width rating buckets, spanning from the lowest rating to the
 * highest with no gaps (empty buckets are included so the x axis stays linear).
 */
export function buildRatingDistribution<P extends DistributionPlayer>(
  players: ReadonlyArray<Readonly<P>>,
  divisionOf: (player: Readonly<P>) => MatchmakingDivision,
): RatingDistribution {
  const rated = players.filter(hasVisibleRating)
  if (!rated.length) {
    return { buckets: [], bucketWidth: 0, ratedCount: 0, median: undefined, sortedRatings: [] }
  }

  const sortedRatings = rated.map(p => p.rating).sort((a, b) => a - b)
  const min = sortedRatings[0]
  const max = sortedRatings[sortedRatings.length - 1]
  const bucketWidth = pickBucketWidth(max - min)
  const first = Math.floor(min / bucketWidth) * bucketWidth
  const numBuckets = Math.floor(max / bucketWidth) - first / bucketWidth + 1

  const counts = new Array<number>(numBuckets).fill(0)
  const divisionCounts = Array.from(
    { length: numBuckets },
    () => new Map<MatchmakingDivision, number>(),
  )
  for (const player of rated) {
    const index = Math.floor((player.rating - first) / bucketWidth)
    counts[index] += 1
    const division = divisionOf(player)
    divisionCounts[index].set(division, (divisionCounts[index].get(division) ?? 0) + 1)
  }

  const buckets: RatingBucket[] = []
  let atOrAbove = rated.length
  for (let i = 0; i < numBuckets; i++) {
    const start = first + i * bucketWidth
    buckets.push({
      start,
      end: start + bucketWidth,
      count: counts[i],
      atOrAbove,
      division: mostCommonDivision(divisionCounts[i]),
    })
    atOrAbove -= counts[i]
  }

  return {
    buckets,
    bucketWidth,
    ratedCount: rated.length,
    median: medianOfSorted(sortedRatings),
    sortedRatings,
  }
}

function mostCommonDivision(counts: ReadonlyMap<MatchmakingDivision, number>): MatchmakingDivision {
  let best = MatchmakingDivision.Unrated
  let bestCount = 0
  // Divisions are visited in ladder order, so `>=` lets the higher of two tied divisions win.
  for (const division of Object.values(MatchmakingDivision)) {
    const count = counts.get(division) ?? 0
    if (count > 0 && count >= bestCount) {
      best = division
      bestCount = count
    }
  }
  return best
}

function medianOfSorted(sorted: ReadonlyArray<number>): number {
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/**
 * The fraction of `sortedRatings` (ascending) that is at or above `rating`, i.e. the "top X" a
 * player with that rating is in. Returns 0 for an empty list.
 */
export function fractionAtOrAbove(sortedRatings: ReadonlyArray<number>, rating: number): number {
  if (!sortedRatings.length) {
    return 0
  }
  let low = 0
  let high = sortedRatings.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (sortedRatings[mid] < rating) {
      low = mid + 1
    } else {
      high = mid
    }
  }
  return (sortedRatings.length - low) / sortedRatings.length
}
