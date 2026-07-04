import { MatchmakingType } from '../../../common/matchmaking'
import { SbUserId } from '../../../common/users/sb-user-id'
import { DbClient } from '../db'
import { sql } from '../db/sql'

/** Per-user record of what a game nullification restored, stored in `game_points_refunds.details`. */
export interface GamePointsRefundDetail {
  userId: SbUserId
  matchmakingType: MatchmakingType
  pointsRefunded: number
  bonusRefunded: number
}

/**
 * Records that a game's points were refunded, unless it already has been. Returns true if this call
 * recorded the refund, false if the game was already refunded — the `INSERT ... ON CONFLICT` is the
 * idempotency guard (a game is refunded at most once). Must run inside the transaction that applies
 * the point changes so the guard and the changes commit together.
 */
export async function tryRecordGamePointsRefund(
  client: DbClient,
  {
    gameId,
    refundedBy,
    details,
  }: {
    gameId: string
    refundedBy: SbUserId | undefined
    details: ReadonlyArray<GamePointsRefundDetail>
  },
): Promise<boolean> {
  const result = await client.query(sql`
    INSERT INTO game_points_refunds (game_id, refunded_by, details)
    VALUES (${gameId}, ${refundedBy ?? null}, ${JSON.stringify(details)})
    ON CONFLICT (game_id) DO NOTHING
    RETURNING game_id;
  `)
  return result.rows.length > 0
}
