import { SbUserId } from '../../../common/users/sb-user-id'
import { DbClient, withDbClient } from '../db'
import { sql } from '../db/sql'

export type ReplayViolationDetails =
  | {
      kind: 'seedMismatch'
      expectedSeed: number
      actualSeed: number
    }
  | { kind: 'clientMismatch' }

export interface ReplayViolation {
  gameId: string
  userId: SbUserId
  details: ReplayViolationDetails
}

// Only these kinds authorize result protection and refund processing. Unrecognized kinds can be
// retained during rolling deployments without an older server deciding their consequences.
const RESULT_PROTECTION_KINDS: ReplayViolationDetails['kind'][] = ['seedMismatch', 'clientMismatch']

/** The caller must hold the game's row lock, shared with result reconciliation and refunds. */
export async function recordReplayViolation(
  client: DbClient,
  violation: ReplayViolation,
): Promise<void> {
  await client.query(sql`
    INSERT INTO game_replay_violations (game_id, user_id, kind, details)
    VALUES (
      ${violation.gameId}, ${violation.userId}, ${violation.details.kind},
      ${JSON.stringify(violation.details)}
    )
    ON CONFLICT (game_id, user_id, kind) DO NOTHING;
  `)
}

/** Handled violations still protect results if a disputed game is resolved manually. */
export async function getReplayViolationUserIds(
  client: DbClient,
  gameId: string,
): Promise<SbUserId[]> {
  const result = await client.query<{ user_id: SbUserId }>(sql`
    SELECT DISTINCT user_id FROM game_replay_violations
    WHERE game_id = ${gameId} AND kind = ANY(${RESULT_PROTECTION_KINDS})
    ORDER BY user_id;
  `)
  return result.rows.map(row => row.user_id)
}

/** Call in the same game-locked transaction that applies or decides the refund. */
export async function markReplayViolationsHandled(client: DbClient, gameId: string): Promise<void> {
  await client.query(sql`
    UPDATE game_replay_violations SET handled_at = NOW()
    WHERE game_id = ${gameId} AND handled_at IS NULL AND kind = ANY(${RESULT_PROTECTION_KINDS});
  `)
}

export async function findPendingReplayViolationGames(limit: number): Promise<string[]> {
  return withDbClient(async client => {
    const result = await client.query<{ game_id: string }>(sql`
      SELECT v.game_id
      FROM game_replay_violations v
      JOIN games g ON g.id = v.game_id
      WHERE v.handled_at IS NULL AND v.next_recovery_at <= NOW()
        AND v.kind = ANY(${RESULT_PROTECTION_KINDS})
        AND (g.results IS NOT NULL OR g.canceled_at IS NOT NULL)
      GROUP BY v.game_id
      ORDER BY MIN(v.next_recovery_at), v.game_id
      LIMIT ${limit};
    `)
    return result.rows.map(row => row.game_id)
  })
}

/** Move failures behind fresh work so one broken game cannot monopolize recovery. */
export async function deferReplayViolationRecovery(gameId: string): Promise<void> {
  await withDbClient(async client => {
    await client.query(sql`
      UPDATE game_replay_violations SET next_recovery_at = NOW() + INTERVAL '1 minute'
      WHERE game_id = ${gameId} AND handled_at IS NULL AND kind = ANY(${RESULT_PROTECTION_KINDS});
    `)
  })
}
