import { NetcodeV2SlotEvidence } from '../../../common/games/netcode-v2'
import db from '../db'
import { sql } from '../db/sql'

export interface EvidenceSession {
  gameId: string
  tenant: string
  session: number
}

export type EvidenceStoreResult = 'stored' | 'pending' | 'ignored'

/**
 * Binds observations to the persisted session roster in the same statement that inserts them.
 * Connections are immutable records: neither a duplicate nor an older arrival replaces another
 * connection. A missing session or roster is retryable because webhooks can beat create's writes.
 */
export async function insertGameSessionEvidence(
  session: EvidenceSession,
  observations: NetcodeV2SlotEvidence[],
): Promise<EvidenceStoreResult> {
  const records = observations.map(({ slot, observation }) => ({
    slot,
    connectionId: observation.connectionId,
    sequence: observation.sequence,
    assignmentRevision: observation.assignmentRevision,
    verdict: observation.verdict,
    keyId: observation.keyId ?? null,
    body: observation.body,
  }))
  const { client, done } = await db()
  try {
    const result = await client.query<{ status: EvidenceStoreResult }>(sql`
      WITH game AS (
        SELECT id, netcode_v2_session, netcode_v2_requested_regions
        FROM games WHERE id = ${session.gameId}
      ), roster AS (
        SELECT r.slot, MIN(r."userId") AS user_id,
          BOOL_OR(COALESCE(r."developmentClient", FALSE)) AS development_client
        FROM game,
          jsonb_to_recordset(game.netcode_v2_requested_regions) AS r(
            slot INTEGER, "userId" INTEGER, "developmentClient" BOOLEAN
          )
        WHERE game.netcode_v2_session = ${session.session}
        GROUP BY r.slot HAVING COUNT(*) = 1
      ), observations AS (
        SELECT slot, "connectionId" AS connection_id, sequence,
          "assignmentRevision" AS assignment_revision, verdict, "keyId" AS key_id, body
        FROM jsonb_to_recordset(${JSON.stringify(records)}::jsonb) AS o(
          slot INTEGER, "connectionId" TEXT, sequence BIGINT, "assignmentRevision" BIGINT,
          verdict TEXT, "keyId" BIGINT, body TEXT
        )
      ), bound AS (
        SELECT o.*, r.user_id, r.development_client FROM observations o JOIN roster r ON r.slot = o.slot
      ), inserted AS (
        INSERT INTO game_session_evidence (
          tenant, session, slot, connection_id, game_id, user_id, sequence, assignment_revision,
          verdict, key_id, body, development_client
        )
        SELECT ${session.tenant}, ${session.session}, slot, decode(connection_id, 'base64'),
          ${session.gameId}::uuid, user_id, sequence, assignment_revision, verdict, key_id,
          decode(body, 'base64'), development_client
        FROM bound
        ON CONFLICT (tenant, session, slot, connection_id) DO NOTHING
      )
      SELECT CASE
        WHEN EXISTS (
          SELECT 1 FROM game
          WHERE netcode_v2_session IS NULL
            OR (netcode_v2_session = ${session.session} AND netcode_v2_requested_regions IS NULL)
        ) THEN 'pending'
        WHEN (SELECT COUNT(*) FROM bound) = ${observations.length} THEN 'stored'
        ELSE 'ignored'
      END AS status
    `)
    return result.rows[0].status
  } finally {
    done()
  }
}
