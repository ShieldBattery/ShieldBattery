import httpErrors from 'http-errors'
import { createHash } from 'node:crypto'
import { SbUserId } from '../../../common/users/sb-user-id'
import db, { DbClient } from '../db'
import { sql } from '../db/sql'
import transact from '../db/transaction'
import { Dbify } from '../db/types'
import { getGameRecord } from '../games/game-models'
import { getUserGameRecord } from '../models/games-users'
import { ClientIdentifierBuffer, ClientIdentifierString } from './client-ids'
import { IDENTIFIER_OBSERVATION_LOCK, IDENTIFIER_RECONCILIATION_LOCK } from './identifier-locks'
import { upsertGameUserIdentifiers } from './user-identifiers'
import { findUserById } from './user-model'

export interface IdentifierObservation {
  requestId: string
  userId: SbUserId
  gameId: string
  observedAt: Date
  identifiers: ClientIdentifierString[]
}

export class IdentifierObservationConflict extends Error {}

/** Deduplicates the observation, stores its identifiers, and schedules reconciliation atomically. */
export async function recordIdentifierObservation(
  observation: IdentifierObservation,
): Promise<void> {
  const identifiers = [...observation.identifiers].sort((a, b) => a[0] - b[0])
  // A compact receipt preserves request identity without duplicating every observed hash forever.
  const identifiersHash = createHash('sha256').update(JSON.stringify(identifiers)).digest()
  await transact(async client => {
    await client.query("SET LOCAL lock_timeout = '3s'")
    await client.query("SET LOCAL statement_timeout = '10s'")
    await client.query(
      sql`SELECT pg_advisory_xact_lock(${IDENTIFIER_OBSERVATION_LOCK}, ${observation.userId})`,
    )
    if (!(await findUserById(observation.userId, client))) {
      throw new httpErrors.NotFound('User not found')
    }
    if (!(await getUserGameRecord(observation.userId, observation.gameId, client))) {
      const game = await getGameRecord(observation.gameId, client)
      if (!game?.config.observers?.includes(observation.userId)) {
        throw new httpErrors.BadRequest('User did not participate in this game')
      }
    }
    const checkReceipt = async () => {
      const existing = await client.query<{
        user_id: SbUserId
        game_id: string
        observed_at: Date
        identifiers_hash: Buffer
      }>(sql`SELECT user_id, game_id, observed_at, identifiers_hash FROM user_identifier_observations
        WHERE request_id = ${observation.requestId}`)
      const row = existing.rows[0]
      if (!row) return false
      if (
        row.user_id !== observation.userId ||
        row.game_id !== observation.gameId ||
        Number(row.observed_at) !== Number(observation.observedAt) ||
        !row.identifiers_hash.equals(identifiersHash)
      ) {
        throw new IdentifierObservationConflict('Request ID already used for another observation')
      }
      return true
    }
    if (await checkReceipt()) return

    // Eligibility follows the persisted game, so re-created source rows cannot renew old work.
    // Keep database precision: rounding expiry through Date could delete a still-eligible receipt.
    // The 90-day duration uses hours so a session time zone cannot move expiry across a DST change.
    const eligible = await client.query<{ expires_at: string }>(sql`
      SELECT (start_time + interval '2160 hours')::text AS expires_at FROM games
      WHERE id = ${observation.gameId}
        AND start_time + interval '2160 hours' > clock_timestamp()
    `)
    if (!eligible.rows.length) throw new httpErrors.BadRequest('Game observation has expired')
    const expiresAt = eligible.rows[0].expires_at
    const inserted = await client.query(sql`
      INSERT INTO user_identifier_observations
        (request_id, user_id, game_id, observed_at, identifiers_hash, expires_at)
      VALUES (${observation.requestId}, ${observation.userId}, ${observation.gameId},
        ${observation.observedAt}, ${identifiersHash}, ${expiresAt})
      ON CONFLICT (request_id) DO NOTHING RETURNING request_id
    `)
    if (!inserted.rowCount) {
      if (!(await checkReceipt())) throw new Error('Missing identifier observation receipt')
      return
    }

    await upsertGameUserIdentifiers(
      observation.userId,
      identifiers.map(([kind, hash]) => [kind, Buffer.from(hash, 'hex')]),
      observation.observedAt,
      client,
    )
    await client.query(sql`
      INSERT INTO user_identifier_reconciliation (user_id, game_id, expires_at)
      VALUES (${observation.userId}, ${observation.gameId}, ${expiresAt})
      ON CONFLICT (user_id, game_id) DO UPDATE
      SET revision = user_identifier_reconciliation.revision + 1,
        pending_since = COALESCE(user_identifier_reconciliation.pending_since, NOW())
    `)
  })
}

export interface IdentifierReconciliation {
  userId: SbUserId
  gameId: string
  revision: string
  processedRevision: string
  requestId: string
  actionState: 'idle' | 'pending' | 'done'
  endTime: Date | null
  notBefore: Date | null
}

function convert(row: Dbify<IdentifierReconciliation>): IdentifierReconciliation {
  return {
    userId: row.user_id,
    gameId: row.game_id,
    revision: row.revision,
    processedRevision: row.processed_revision,
    requestId: row.request_id,
    actionState: row.action_state,
    endTime: row.end_time,
    notBefore: row.not_before,
  }
}

export async function findPendingIdentifierReconciliations(
  excludedUsers: ReadonlyArray<SbUserId> = [],
  limit = 16,
): Promise<IdentifierReconciliation[]> {
  const { client, done } = await db()
  try {
    const result = await client.query<Dbify<IdentifierReconciliation>>(sql`
      SELECT * FROM user_identifier_reconciliation
      WHERE user_id <> ALL(${excludedUsers}::integer[]) AND retry_at <= NOW()
        AND (revision > processed_revision OR
        (action_state = 'pending' AND not_before <= NOW()))
      ORDER BY retry_at, user_id, game_id LIMIT ${limit}
    `)
    return result.rows.map(convert)
  } finally {
    done()
  }
}

/** Serializes workers for an account without holding row locks across restriction or Redis work. */
export async function withIdentifierReconciliation(
  userId: SbUserId,
  gameId: string,
  run: (work: IdentifierReconciliation, client: DbClient) => Promise<void>,
): Promise<void> {
  const { client, done } = await db()
  let locked = false
  let failed = false
  let failure: unknown
  try {
    const result = await client.query<{ locked: boolean }>(sql`
      SELECT pg_try_advisory_lock(${IDENTIFIER_RECONCILIATION_LOCK}, ${userId}) AS locked
    `)
    locked = result.rows[0].locked
    if (locked) {
      const rows = await client.query<Dbify<IdentifierReconciliation>>(sql`
        SELECT * FROM user_identifier_reconciliation
        WHERE user_id = ${userId} AND game_id = ${gameId} AND retry_at <= NOW()
      `)
      if (rows.rows.length) await run(convert(rows.rows[0]), client)
    }
  } catch (err) {
    failed = true
    failure = err
  }

  let discard = false
  try {
    if (locked) {
      await client.query(
        sql`SELECT pg_advisory_unlock(${IDENTIFIER_RECONCILIATION_LOCK}, ${userId})`,
      )
    }
  } catch (err) {
    // A pooled session must never retain a worker lock after its owner returns.
    discard = true
    if (!failed) failure = err
    failed = true
  }
  done(discard)
  if (failed) throw failure
}

export async function getGameIdentifiers(
  userId: SbUserId,
  client: DbClient,
): Promise<ClientIdentifierBuffer[]> {
  const result = await client.query<{ identifier_type: number; identifier_hash: Buffer }>(sql`
    SELECT identifier_type, identifier_hash FROM user_identifiers
    WHERE user_id = ${userId} AND source = 'game'
    ORDER BY identifier_type, identifier_hash
  `)
  return result.rows.map(row => [row.identifier_type, row.identifier_hash])
}

export async function finishIdentifierReconciliation(
  work: IdentifierReconciliation,
  client: DbClient,
): Promise<void> {
  await client.query(sql`UPDATE user_identifier_reconciliation
    SET processed_revision = ${work.revision}::bigint, retry_at = NOW(),
      pending_since = CASE WHEN revision = ${work.revision}::bigint THEN NULL ELSE pending_since END
    WHERE user_id = ${work.userId} AND game_id = ${work.gameId}`)
}

export async function scheduleIdentifierBan(
  work: IdentifierReconciliation,
  endTime: Date,
  client: DbClient,
): Promise<void> {
  await client.query(sql`
    WITH schedule AS MATERIALIZED (SELECT moderation_action_not_before(NOW()) AS due)
    UPDATE user_identifier_reconciliation
    SET action_state = 'pending', not_before = schedule.due,
      end_time = GREATEST(${endTime}::timestamptz, schedule.due + interval '1 hour')
    FROM schedule
    WHERE user_id = ${work.userId} AND game_id = ${work.gameId} AND action_state = 'idle'
  `)
}

export async function finishIdentifierBan(
  work: IdentifierReconciliation,
  state: 'idle' | 'done',
  client: DbClient,
): Promise<void> {
  await client.query(sql`UPDATE user_identifier_reconciliation
    SET action_state = ${state}, retry_at = NOW()
    WHERE user_id = ${work.userId} AND game_id = ${work.gameId}`)
}

export async function retryIdentifierReconciliation(
  work: IdentifierReconciliation,
  client: DbClient,
): Promise<void> {
  await client.query(sql`UPDATE user_identifier_reconciliation
    SET retry_at = NOW() + interval '5 minutes'
    WHERE user_id = ${work.userId} AND game_id = ${work.gameId}`)
}

/** Deletes bounded expired history without waiting on ingestion or an active account worker. */
export async function pruneIdentifierObservations(): Promise<{
  observations: number
  reconciliations: number
}> {
  return transact(async client => {
    await client.query("SET LOCAL lock_timeout = '1s'")
    await client.query("SET LOCAL statement_timeout = '5s'")
    const result = await client.query<{ observations: number; reconciliations: number }>(sql`
      WITH cutoff AS MATERIALIZED (SELECT clock_timestamp() AS at),
      observation_candidates AS MATERIALIZED (
        SELECT request_id, user_id FROM user_identifier_observations
        WHERE expires_at <= (SELECT at FROM cutoff)
        ORDER BY expires_at, request_id LIMIT 1000
      ), reconciliation_candidates AS MATERIALIZED (
        SELECT user_id, game_id FROM user_identifier_reconciliation
        WHERE expires_at <= (SELECT at FROM cutoff) AND revision = processed_revision
          AND action_state IN ('idle', 'done')
        ORDER BY expires_at, user_id, game_id LIMIT 1000
      ), accounts AS MATERIALIZED (
        SELECT user_id FROM observation_candidates
        UNION SELECT user_id FROM reconciliation_candidates
      ), workers AS MATERIALIZED (
        SELECT user_id FROM accounts
        WHERE pg_try_advisory_xact_lock(${IDENTIFIER_RECONCILIATION_LOCK}, user_id)
      ), admissions AS MATERIALIZED (
        SELECT user_id FROM workers
        WHERE pg_try_advisory_xact_lock(${IDENTIFIER_OBSERVATION_LOCK}, user_id)
      ), observations AS (
        DELETE FROM user_identifier_observations AS o
        USING observation_candidates AS c, admissions AS a
        WHERE o.request_id = c.request_id AND o.user_id = a.user_id
          AND o.expires_at <= (SELECT at FROM cutoff)
        RETURNING o.request_id
      ), reconciliations AS (
        DELETE FROM user_identifier_reconciliation AS r
        USING reconciliation_candidates AS c, admissions AS a
        WHERE r.user_id = c.user_id AND r.game_id = c.game_id AND r.user_id = a.user_id
          AND r.expires_at <= (SELECT at FROM cutoff) AND r.revision = r.processed_revision
          AND r.action_state IN ('idle', 'done')
        RETURNING r.game_id
      )
      SELECT (SELECT count(*)::integer FROM observations) AS observations,
        (SELECT count(*)::integer FROM reconciliations) AS reconciliations
    `)
    return result.rows[0]
  })
}
