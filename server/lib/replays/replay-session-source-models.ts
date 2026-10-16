import type { Player, ReplayHeader, ShieldBatteryData } from '@shieldbattery/broodrep'
import { SbUserId } from '../../../common/users/sb-user-id'
import db, { DbClient } from '../db'
import { sql } from '../db/sql'
import { Dbify } from '../db/types'

/** A local replay file staged privately for a future multiplayer replay session. */
export interface ReplaySessionUpload {
  id: string
  ownerUserId: SbUserId
  hash: Buffer
  size: number
  parserVersion: number
  header: ReplayHeader
  slots: Player[]
  sbData: ShieldBatteryData | null
  createdAt: Date
  expiresAt: Date
}

type DbReplaySessionUpload = Dbify<ReplaySessionUpload>

function fromDb(row: DbReplaySessionUpload): ReplaySessionUpload {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    hash: row.hash,
    size: row.size,
    parserVersion: row.parser_version,
    header: row.header,
    slots: row.slots,
    sbData: row.sb_data,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }
}

export async function createReplaySessionUpload(
  {
    ownerUserId,
    hash,
    size,
    parserVersion,
    header,
    slots,
    sbData,
    expiresAt,
  }: Omit<ReplaySessionUpload, 'id' | 'createdAt'>,
  withClient?: DbClient,
): Promise<ReplaySessionUpload> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbReplaySessionUpload>(sql`
      INSERT INTO replay_session_uploads (
        owner_user_id, hash, size, parser_version, header, slots, sb_data, expires_at
      ) VALUES (
        ${ownerUserId}, ${hash}, ${size}, ${parserVersion}, ${JSON.stringify(header)},
        ${JSON.stringify(slots)}, ${sbData ? JSON.stringify(sbData) : null},
        ${expiresAt}
      )
      RETURNING *
    `)
    return fromDb(result.rows[0])
  } finally {
    done()
  }
}

/**
 * Resolves an owner's unexpired upload and pushes its expiry out to at least `expiresAt` in the
 * same statement. Cleanup only claims rows that have already expired, so an upload this returns
 * can't be deleted out from under the session that retained it until `expiresAt` passes.
 */
export async function retainReplaySessionUploadForOwner(
  id: string,
  ownerUserId: SbUserId,
  now: Date,
  expiresAt: Date,
  withClient?: DbClient,
): Promise<ReplaySessionUpload | undefined> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbReplaySessionUpload>(sql`
      UPDATE replay_session_uploads
      SET expires_at = GREATEST(expires_at, ${expiresAt})
      WHERE id = ${id} AND owner_user_id = ${ownerUserId} AND expires_at > ${now}
      RETURNING *
    `)
    return result.rows[0] ? fromDb(result.rows[0]) : undefined
  } finally {
    done()
  }
}

/**
 * Pushes the expiry of every listed, still-unexpired upload out to at least `expiresAt`, returning
 * the ids that were retained. An id missing from the result had already expired, and its object
 * may already be gone.
 */
export async function retainReplaySessionUploads(
  ids: ReadonlyArray<string>,
  now: Date,
  expiresAt: Date,
  withClient?: DbClient,
): Promise<string[]> {
  if (ids.length === 0) {
    return []
  }

  const { client, done } = await db(withClient)
  try {
    const result = await client.query<{ id: string }>(sql`
      UPDATE replay_session_uploads
      SET expires_at = GREATEST(expires_at, ${expiresAt})
      WHERE id = ANY(${ids}) AND expires_at > ${now}
      RETURNING id
    `)
    return result.rows.map(row => row.id)
  } finally {
    done()
  }
}

/**
 * Claims one bounded batch of expired uploads for private-object cleanup. Claims automatically
 * become available again after `retryBefore` if a process stops before it releases them.
 */
export async function claimExpiredReplaySessionUploads(
  now: Date,
  retryBefore: Date,
  cleanupToken: string,
  withClient?: DbClient,
): Promise<string[]> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<{ id: string }>(sql`
      WITH candidates AS (
        SELECT id
        FROM replay_session_uploads
        WHERE expires_at <= ${now}
          AND (cleanup_claimed_at IS NULL OR cleanup_claimed_at <= ${retryBefore})
        ORDER BY expires_at
        LIMIT 100
        FOR UPDATE SKIP LOCKED
      )
      UPDATE replay_session_uploads uploads
      SET cleanup_token = ${cleanupToken}, cleanup_claimed_at = ${now}
      FROM candidates
      WHERE uploads.id = candidates.id
      RETURNING uploads.id
    `)
    return result.rows.map(row => row.id)
  } finally {
    done()
  }
}

/** Deletes uploads only if this cleanup worker still owns their active claims. */
export async function deleteClaimedReplaySessionUploads(
  ids: ReadonlyArray<string>,
  cleanupToken: string,
  now: Date,
  withClient?: DbClient,
): Promise<void> {
  if (ids.length === 0) {
    return
  }

  const { client, done } = await db(withClient)
  try {
    await client.query(sql`
      DELETE FROM replay_session_uploads
      WHERE id = ANY(${ids}) AND cleanup_token = ${cleanupToken} AND expires_at <= ${now}
    `)
  } finally {
    done()
  }
}

/** Releases failed object-cleanup claims so the next cleanup run can retry them immediately. */
export async function releaseReplaySessionUploadClaims(
  ids: ReadonlyArray<string>,
  cleanupToken: string,
  withClient?: DbClient,
): Promise<void> {
  if (ids.length === 0) {
    return
  }

  const { client, done } = await db(withClient)
  try {
    await client.query(sql`
      UPDATE replay_session_uploads
      SET cleanup_token = NULL, cleanup_claimed_at = NULL
      WHERE id = ANY(${ids}) AND cleanup_token = ${cleanupToken}
    `)
  } finally {
    done()
  }
}

export async function deleteReplaySessionUpload(id: string, withClient?: DbClient): Promise<void> {
  const { client, done } = await db(withClient)
  try {
    await client.query(sql`DELETE FROM replay_session_uploads WHERE id = ${id}`)
  } finally {
    done()
  }
}
