import { RollbackStats } from '../../../common/games/rollback-stats'
import { SbUserId } from '../../../common/users/sb-user-id'
import { withDbClient } from '../db'
import { sql } from '../db/sql'

/**
 * Returns the bucket index holding the `percentile`th percentile of a histogram whose entries count
 * ticks per bucket, using the nearest-rank method over the histogram's total ticks: the smallest
 * index whose cumulative count reaches `ceil(percentile / 100 * total)` (and at least 1). Returns
 * `null` when the histogram holds no ticks.
 *
 * @param percentile A percentile in (0, 100].
 */
export function histogramPercentile(
  histogram: ReadonlyArray<number>,
  percentile: number,
): number | null {
  const total = histogram.reduce((sum, count) => sum + count, 0)
  if (total <= 0) {
    return null
  }

  // `total * percentile` is an exact integer, so dividing it by 100 rounds at most within the
  // fractional part and can't push an exact integer rank across a boundary.
  const rank = Math.max(1, Math.ceil((total * percentile) / 100))
  let cumulative = 0
  for (let i = 0; i < histogram.length; i++) {
    cumulative += histogram[i]
    if (cumulative >= rank) {
      return i
    }
  }

  // Only reachable for a percentile above 100.
  return histogram.length - 1
}

/**
 * Stores a rollback client's statistics for a game. Only the first submission for a (game, user) is
 * kept; later ones are no-ops.
 *
 * @returns whether a row was actually inserted (false means stats were already stored).
 */
export async function insertGameRollbackStats({
  gameId,
  userId,
  stats,
}: {
  gameId: string
  userId: SbUserId
  stats: RollbackStats
}): Promise<boolean> {
  return await withDbClient(async client => {
    const result = await client.query(sql`
      INSERT INTO game_rollback_stats (
        game_id, user_id, ticks, through_turn, rollback_target, prediction_limit, capped_ticks,
        rollbacks, resimulated_frames, deepest_rollback, mispredicted_turns, slow_ticks,
        worst_tick_us, rollback_p50, rollback_p90, pipe_p50, pipe_p90, rollback_histogram,
        pipe_histogram, details
      ) VALUES (
        ${gameId}, ${userId}, ${stats.ticks}, ${stats.throughTurn}, ${stats.rollbackTarget},
        ${stats.predictionLimit}, ${stats.cappedTicks}, ${stats.rollbacks},
        ${stats.resimulatedFrames}, ${stats.deepestRollback}, ${stats.mispredictedTurns},
        ${stats.slowTicks}, ${stats.worstTickUs},
        ${histogramPercentile(stats.rollbackHistogram, 50)},
        ${histogramPercentile(stats.rollbackHistogram, 90)},
        ${histogramPercentile(stats.pipeHistogram, 50)},
        ${histogramPercentile(stats.pipeHistogram, 90)},
        ${stats.rollbackHistogram}, ${stats.pipeHistogram}, ${JSON.stringify(stats)}
      )
      ON CONFLICT (game_id, user_id) DO NOTHING
    `)

    return !!result.rowCount
  })
}
