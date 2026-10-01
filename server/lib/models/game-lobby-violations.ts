import { ReadonlyDeep } from 'type-fest'
import { SbUserId } from '../../../common/users/sb-user-id'
import { DbClient } from '../db'
import db from '../db'
import { sql } from '../db/sql'
import { GAME_PENALTY_ENFORCEMENT_LEASE_MINUTES } from '../matchmaking/matchmaking-ban-models'
import { ClientIdentifierString } from '../users/client-ids'

export interface GameLobbyViolation {
  gameId: string
  userId: SbUserId
  detectedAt: Date
  /** The offender's client identifiers as known when the violation was staged. */
  identifiers: ReadonlyDeep<ClientIdentifierString[]>
}

export interface ClaimedGameLobbyViolation {
  gameId: string
  userId: SbUserId
  detectedAt: Date
  recoveryAttempts: number
}

const RECOVERY_LEASE_MS = 60 * 1000
/**
 * How many times recovery claims one violation before leaving it alone. At one claim per lease this
 * is about an hour of retries, comfortably past any transient outage; a violation still failing
 * after that needs a person to look at it, not another attempt every minute.
 */
export const MAX_RECOVERY_ATTEMPTS = 60

/**
 * Records the first pre-load lobby-policy violation for a game. Returns the offender the game's
 * violation is recorded against, which is someone other than `violation.userId` if another
 * player's violation was recorded first.
 */
export async function recordGameLobbyViolation(
  client: DbClient,
  violation: GameLobbyViolation,
): Promise<{ inserted: boolean; userId: SbUserId }> {
  const inserted = await client.query(sql`
    INSERT INTO game_lobby_violations (game_id, user_id, detected_at, identifiers)
    VALUES (
      ${violation.gameId},
      ${violation.userId},
      ${violation.detectedAt},
      ${JSON.stringify(violation.identifiers)}
    )
    ON CONFLICT (game_id) DO NOTHING
  `)
  if (inserted.rowCount) {
    return { inserted: true, userId: violation.userId }
  }

  const existing = await client.query<{ user_id: SbUserId }>(sql`
    SELECT user_id FROM game_lobby_violations WHERE game_id = ${violation.gameId}
  `)
  return { inserted: false, userId: existing.rows[0].user_id }
}

export async function getGameLobbyViolation(
  gameId: string,
): Promise<GameLobbyViolation | undefined> {
  const { client, done } = await db()
  try {
    const result = await client.query<{
      game_id: string
      user_id: SbUserId
      detected_at: Date
      identifiers: ClientIdentifierString[]
    }>(sql`
      SELECT game_id, user_id, detected_at, identifiers
      FROM game_lobby_violations
      WHERE game_id = ${gameId}
    `)
    const row = result.rows[0]
    return row
      ? {
          gameId: row.game_id,
          userId: row.user_id,
          detectedAt: row.detected_at,
          identifiers: row.identifiers,
        }
      : undefined
  } finally {
    done()
  }
}

/**
 * Claims a bounded batch of staged violations for recovery. The lease makes a failed worker
 * retry later without allowing a large backlog to monopolize each scheduler run.
 */
export async function claimPendingGameLobbyViolations(
  limit: number,
  now: Date = new Date(),
): Promise<ClaimedGameLobbyViolation[]> {
  const { client, done } = await db()
  try {
    const result = await client.query<{
      game_id: string
      user_id: SbUserId
      detected_at: Date
      recovery_attempts: number
    }>(sql`
      WITH candidates AS (
        SELECT v.game_id
        FROM game_lobby_violations v
        JOIN games g ON g.id = v.game_id
        LEFT JOIN matchmaking_game_bans b ON b.game_id = v.game_id AND b.user_id = v.user_id
        WHERE g.cancellation_reason = 'gameAnomaly'
          AND (g.results IS NULL OR b.enforced_at IS NULL)
          -- Enforcement leased to a live worker is the only work left, so there's nothing to
          -- recover yet. Claiming it anyway would spend an attempt on doing nothing.
          AND NOT COALESCE(
            g.results IS NOT NULL
              AND b.enforcement_claimed_at >=
                NOW() - make_interval(mins => ${GAME_PENALTY_ENFORCEMENT_LEASE_MINUTES}),
            false
          )
          AND v.next_recovery_at <= ${now}
          AND v.recovery_attempts < ${MAX_RECOVERY_ATTEMPTS}
        ORDER BY v.next_recovery_at, v.detected_at
        LIMIT ${limit}
        FOR UPDATE OF v SKIP LOCKED
      )
      UPDATE game_lobby_violations v
      SET recovery_attempts = v.recovery_attempts + 1,
          next_recovery_at = ${new Date(now.getTime() + RECOVERY_LEASE_MS)}
      FROM candidates
      WHERE v.game_id = candidates.game_id
      RETURNING v.game_id, v.user_id, v.detected_at, v.recovery_attempts
    `)
    return result.rows.map(row => ({
      gameId: row.game_id,
      userId: row.user_id,
      detectedAt: row.detected_at,
      recoveryAttempts: row.recovery_attempts,
    }))
  } finally {
    done()
  }
}
