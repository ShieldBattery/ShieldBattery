import type { Player, ReplayHeader, ShieldBatteryData } from '@shieldbattery/broodrep'
import { SbUserId } from '../../../common/users/sb-user-id'
import db, { DbClient } from '../db'
import { sql } from '../db/sql'
import { Dbify } from '../db/types'

/** The current version of the replay parser. Update this when parsing changes. */
export const REPLAY_PARSER_VERSION = 1

/**
 * A replay file record as stored in the database.
 */
export interface ReplayFile {
  id: string
  hash: Buffer
  size: number
  uploadedAt: Date
  uploadedBy: SbUserId | null
  parserVersion: number
  header: ReplayHeader
  slots: Player[]
  sbData: ShieldBatteryData | null
}

type DbReplayFile = Dbify<ReplayFile>

/**
 * The data needed to insert a new replay file record into the database.
 */
export interface InsertReplayFileData {
  hash: Buffer
  size: number
  uploadedBy: SbUserId
  parserVersion: number
  header: ReplayHeader
  slots: Player[]
  sbData: ShieldBatteryData | null
}

function rowToReplayFile(row: DbReplayFile): ReplayFile {
  return {
    id: row.id,
    hash: row.hash,
    size: row.size,
    uploadedAt: row.uploaded_at,
    uploadedBy: row.uploaded_by,
    parserVersion: row.parser_version,
    header: row.header,
    slots: row.slots,
    sbData: row.sb_data,
  }
}

/**
 * Finds an existing replay file by its hash and size (for deduplication).
 */
export async function findReplayByHashAndSize(
  hash: Buffer,
  size: number,
  client?: DbClient,
): Promise<ReplayFile | null> {
  const { client: dbClient, done } = await db(client)
  try {
    const result = await dbClient.query<DbReplayFile>(sql`
      SELECT * FROM replay_files
      WHERE hash = ${hash} AND size = ${size}
    `)
    return result.rows[0] ? rowToReplayFile(result.rows[0]) : null
  } finally {
    done()
  }
}

/**
 * Deletes a replay file record from the database.
 */
export async function deleteReplayFile(id: string, client?: DbClient): Promise<void> {
  const { client: dbClient, done } = await db(client)
  try {
    await dbClient.query(sql`DELETE FROM replay_files WHERE id = ${id}`)
  } finally {
    done()
  }
}

/**
 * Inserts a new replay file record into the database.
 */
export async function insertReplayFile(
  data: InsertReplayFileData,
  client?: DbClient,
): Promise<ReplayFile> {
  const { client: dbClient, done } = await db(client)
  try {
    const result = await dbClient.query<DbReplayFile>(sql`
      INSERT INTO replay_files (hash, size, uploaded_by, parser_version, header, slots, sb_data)
      VALUES (
        ${data.hash},
        ${data.size},
        ${data.uploadedBy},
        ${data.parserVersion},
        ${JSON.stringify(data.header)},
        ${JSON.stringify(data.slots)},
        ${data.sbData ? JSON.stringify(data.sbData) : null}
      )
      RETURNING *
    `)
    return rowToReplayFile(result.rows[0])
  } finally {
    done()
  }
}

/**
 * Gets the "best" replay for a game (longest duration based on frame count).
 */
export async function getBestReplayForGame(
  gameId: string,
  client?: DbClient,
): Promise<ReplayFile | null> {
  const { client: dbClient, done } = await db(client)
  try {
    const result = await dbClient.query<DbReplayFile>(sql`
      SELECT rf.*
      FROM replay_files rf
      JOIN games_users gu ON gu.replay_file_id = rf.id
      WHERE gu.game_id = ${gameId}
      ORDER BY (rf.header->>'frames')::int DESC NULLS LAST
      LIMIT 1
    `)
    return result.rows[0] ? rowToReplayFile(result.rows[0]) : null
  } finally {
    done()
  }
}

/**
 * Gets all replays for a game with uploader info (for admin debug view).
 */
export async function getAllReplaysForGame(
  gameId: string,
  client?: DbClient,
): Promise<Array<ReplayFile & { uploadedByGameUserId: SbUserId }>> {
  const { client: dbClient, done } = await db(client)
  try {
    const result = await dbClient.query<DbReplayFile & { uploader_user_id: SbUserId }>(sql`
      SELECT rf.*, gu.user_id as uploader_user_id
      FROM replay_files rf
      JOIN games_users gu ON gu.replay_file_id = rf.id
      WHERE gu.game_id = ${gameId}
      ORDER BY (rf.header->>'frames')::int DESC NULLS LAST
    `)
    return result.rows.map(row => ({
      ...rowToReplayFile(row),
      uploadedByGameUserId: row.uploader_user_id,
    }))
  } finally {
    done()
  }
}
