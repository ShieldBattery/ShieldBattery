import { NetcodeV2SlotEvidence } from '../../../common/games/netcode-v2'
import db from '../db'
import { sql } from '../db/sql'
import log from '../logging/logger'

import { EvidenceSession, EvidenceStoreResult } from './game-session-evidence'
import { mergePeriodicEvidence } from './merge-periodic-evidence'

/**
 * Binds observations to the persisted session roster in the same statement that inserts them.
 * Sample contents are immutable; repeated deliveries can enrich historical metadata without
 * incrementing cumulative counts. A missing session or roster is retryable because webhooks can
 * beat create's writes.
 */
export async function insertGameSessionPeriodicEvidence(
  session: EvidenceSession,
  observations: NetcodeV2SlotEvidence[],
): Promise<EvidenceStoreResult> {
  const { observations: merged, conflicts } = mergePeriodicEvidence(observations)
  if (conflicts.length) {
    log.warn(
      {
        gameId: session.gameId,
        tenant: session.tenant,
        session: session.session,
        conflictingSamples: conflicts.length,
        sampleIds: conflicts.slice(0, 8),
      },
      'Ignoring conflicting periodic evidence samples',
    )
  }
  if (!merged.length) return 'ignored'
  const records = Array.from(
    merged,
    ({ slot, observation, historical, failureCount, observedAtMs }) => ({
      slot,
      connectionId: observation.connectionId,
      sampleId: observation.sampleId,
      sequence: observation.sequence,
      assignmentRevision: observation.assignmentRevision,
      verdict: observation.verdict,
      keyId: observation.keyId ?? null,
      body: observation.body,
      interruption: observation.interruption ?? null,
      historical: historical ?? false,
      failureCount: failureCount ?? null,
      observedAtMs: observedAtMs ?? null,
    }),
  )
  const { client, done } = await db()
  try {
    const result = await client.query<{ status: EvidenceStoreResult }>(sql`
      WITH game AS (
        SELECT id, netcode_v2_session, netcode_v2_requested_regions
        FROM games WHERE id = ${session.gameId}
      ), roster AS (
        SELECT r.slot, MIN(r."userId") AS user_id
        FROM game,
          jsonb_to_recordset(game.netcode_v2_requested_regions) AS r(slot INTEGER, "userId" INTEGER)
        WHERE game.netcode_v2_session = ${session.session}
        GROUP BY r.slot HAVING COUNT(*) = 1
      ), observations AS (
        SELECT slot, "connectionId" AS connection_id, "sampleId" AS sample_id, sequence,
          "assignmentRevision" AS assignment_revision, verdict, "keyId" AS key_id, body,
          interruption, historical, "failureCount" AS failure_count,
          to_timestamp("observedAtMs" / 1000.0) AS observed_at
        FROM jsonb_to_recordset(${JSON.stringify(records)}::jsonb) AS o(
          slot INTEGER, "connectionId" TEXT, "sampleId" BIGINT, sequence BIGINT, "assignmentRevision" BIGINT,
          verdict TEXT, "keyId" BIGINT, body TEXT, interruption TEXT, historical BOOLEAN,
          "failureCount" BIGINT, "observedAtMs" BIGINT
        )
      ), bound AS (
        SELECT o.*, r.user_id FROM observations o JOIN roster r ON r.slot = o.slot
      ), inserted AS (
        INSERT INTO game_session_periodic_evidence (
          tenant, session, slot, connection_id, sample_id, game_id, user_id, sequence, assignment_revision,
          verdict, key_id, body, interruption, historical, failure_count, observed_at
        )
        SELECT ${session.tenant}, ${session.session}, slot, decode(connection_id, 'base64'), sample_id,
          ${session.gameId}::uuid, user_id, sequence, assignment_revision, verdict, key_id,
          decode(body, 'base64'), interruption, historical, failure_count, observed_at
        FROM bound
        ON CONFLICT (tenant, session, slot, connection_id, sample_id) DO UPDATE SET
          interruption = COALESCE(game_session_periodic_evidence.interruption, EXCLUDED.interruption),
          historical = game_session_periodic_evidence.historical OR EXCLUDED.historical,
          failure_count = GREATEST(game_session_periodic_evidence.failure_count, EXCLUDED.failure_count),
          observed_at = COALESCE(game_session_periodic_evidence.observed_at, EXCLUDED.observed_at)
        WHERE game_session_periodic_evidence.game_id = EXCLUDED.game_id
          AND game_session_periodic_evidence.user_id = EXCLUDED.user_id
          AND game_session_periodic_evidence.sequence = EXCLUDED.sequence
          AND game_session_periodic_evidence.assignment_revision = EXCLUDED.assignment_revision
          AND game_session_periodic_evidence.verdict = EXCLUDED.verdict
          AND game_session_periodic_evidence.key_id IS NOT DISTINCT FROM EXCLUDED.key_id
          AND game_session_periodic_evidence.body = EXCLUDED.body
          AND (game_session_periodic_evidence.interruption IS NULL
            OR EXCLUDED.interruption IS NULL
            OR game_session_periodic_evidence.interruption = EXCLUDED.interruption)
        RETURNING 1
      )
      SELECT CASE
        WHEN EXISTS (
          SELECT 1 FROM game
          WHERE netcode_v2_session IS NULL
            OR (netcode_v2_session = ${session.session} AND netcode_v2_requested_regions IS NULL)
        ) THEN 'pending'
        WHEN (SELECT COUNT(*) FROM inserted) = ${records.length} THEN 'stored'
        ELSE 'ignored'
      END AS status
    `)
    return result.rows[0].status
  } finally {
    done()
  }
}
