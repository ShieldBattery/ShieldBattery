import { LeagueId } from '../../../common/leagues/leagues'
import { MatchmakingType } from '../../../common/matchmaking'
import { SbUserId } from '../../../common/users/sb-user-id'
import { DbClient } from '../db'
import { sql } from '../db/sql'

/**
 * A single point restoration performed by a game nullification, stored in
 * `game_points_refunds.details`. Discriminated by `kind` because matchmaking and league points are
 * separate currencies — a nullified league game restores both, and either can occur without the
 * other (e.g. a matchmaking loss clamped to 0 points while league points were still lost).
 */
export type GamePointsRefundDetail =
  | {
      kind: 'matchmaking'
      userId: SbUserId
      matchmakingType: MatchmakingType
      pointsRefunded: number
      bonusRefunded: number
    }
  | {
      kind: 'league'
      userId: SbUserId
      leagueId: LeagueId
      pointsRefunded: number
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
