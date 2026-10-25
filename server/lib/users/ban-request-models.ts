import { SbUserId } from '../../../common/users/sb-user-id'
import { DbClient } from '../db'
import { sql } from '../db/sql'
import { Dbify } from '../db/types'

export interface BanRequest {
  requestId: string
  targetId: SbUserId
  endTime: Date
  reason: string
  gameId?: string | null
}

export interface BanRequestReceipt extends BanRequest {
  banId: string | null
  banIds: string[] | null
  completedAt: Date | null
}

export class BanRequestConflict extends Error {}

/** Locks the receipt until the caller's transaction ends, including concurrent first requests. */
export async function lockBanRequest(
  request: BanRequest,
  client: DbClient,
): Promise<BanRequestReceipt> {
  await client.query("SET LOCAL lock_timeout = '3s'")
  await client.query("SET LOCAL statement_timeout = '10s'")
  await client.query(sql`
    INSERT INTO user_ban_requests (request_id, target_id, end_time, reason, game_id)
    VALUES (
      ${request.requestId}, ${request.targetId}, ${request.endTime}, ${request.reason},
      ${request.gameId ?? null}
    )
    ON CONFLICT (request_id) DO NOTHING
  `)
  const result = await client.query<Dbify<BanRequestReceipt>>(sql`
    SELECT * FROM user_ban_requests WHERE request_id = ${request.requestId} FOR UPDATE
  `)
  const row = result.rows[0]
  if (
    row.target_id !== request.targetId ||
    row.end_time.getTime() !== request.endTime.getTime() ||
    row.reason !== request.reason ||
    row.game_id !== (request.gameId ?? null)
  ) {
    throw new BanRequestConflict('Request ID already used for another ban')
  }
  return {
    ...request,
    gameId: row.game_id,
    banId: row.ban_id,
    banIds: row.ban_ids,
    completedAt: row.completed_at,
  }
}

export async function recordBanRequestBans(
  requestId: string,
  banId: string,
  banIds: string[],
  client: DbClient,
): Promise<void> {
  await client.query(sql`
    UPDATE user_ban_requests SET ban_id = ${banId}, ban_ids = ${banIds}::uuid[]
    WHERE request_id = ${requestId}
  `)
}

export async function completeBanRequest(requestId: string, client: DbClient): Promise<void> {
  await client.query(sql`
    UPDATE user_ban_requests SET completed_at = NOW() WHERE request_id = ${requestId}
  `)
}
