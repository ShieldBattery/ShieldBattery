import { createHash, randomUUID } from 'crypto'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { pipeline } from 'stream/promises'
import { singleton } from 'tsyringe'
import {
  ReplaySessionSourceMetadata,
  StageReplaySessionSourceResponse,
} from '../../../common/replay-sessions'
import { SbUserId } from '../../../common/users/sb-user-id'
import { parseReplay } from '../../workers/replays/replays'
import { deleteFile, writeFile } from '../files'
import logger from '../logging/logger'
import { Clock } from '../time/clock'
import {
  claimExpiredReplaySessionUploads,
  createReplaySessionUpload,
  deleteClaimedReplaySessionUploads,
  deleteReplaySessionUpload,
  getReplaySessionUploadForOwner,
  releaseReplaySessionUploadClaims,
  ReplaySessionUpload,
} from './replay-session-source-models'

const SOURCE_LIFETIME_MS = 24 * 60 * 60 * 1000
const CLEANUP_CLAIM_LIFETIME_MS = 5 * 60 * 1000

export enum ReplaySessionSourceErrorCode {
  InvalidReplay = 'InvalidReplay',
}

export class ReplaySessionSourceError extends Error {
  constructor(
    readonly code: ReplaySessionSourceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

/** Returns the private storage location for one staged replay upload. */
export function replaySessionUploadPath(sourceId: string): string {
  return `replay-session-uploads/${sourceId}.rep`
}

async function deleteStoredUpload(sourceId: string): Promise<void> {
  try {
    await deleteFile(replaySessionUploadPath(sourceId))
  } catch (err) {
    // A failed upload may have left a database row without ever creating its object.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err
    }
  }
}

function toMetadata(upload: ReplaySessionUpload): ReplaySessionSourceMetadata {
  return {
    mapName: upload.header.mapName,
    gameType: String(upload.header.gameType),
    durationFrames: upload.header.frames,
  }
}

function toResponse(upload: ReplaySessionUpload): StageReplaySessionSourceResponse {
  return {
    sourceId: upload.id,
    hash: upload.hash.toString('hex'),
    size: upload.size,
    metadata: toMetadata(upload),
  }
}

async function computeHashAndSize(filePath: string): Promise<{ hash: Buffer; size: number }> {
  const [fileStat, hash] = await Promise.all([
    stat(filePath),
    new Promise<Buffer>((resolve, reject) => {
      const hashStream = createHash('sha256')
      const fileStream = createReadStream(filePath)
      pipeline(fileStream, hashStream)
        .then(() => resolve(hashStream.digest()))
        .catch(reject)
    }),
  ])

  return { hash, size: fileStat.size }
}

@singleton()
export class ReplaySessionSourceService {
  constructor(private clock: Clock) {}

  /** Parses, hashes, and privately stores a local replay for its owner to use within 24 hours. */
  async stageUpload(
    filePath: string,
    ownerUserId: SbUserId,
  ): Promise<StageReplaySessionSourceResponse> {
    const [parsedResult, fileInfo] = await Promise.all([
      parseReplay(filePath),
      computeHashAndSize(filePath),
    ])
    if (parsedResult.isError()) {
      throw new ReplaySessionSourceError(
        ReplaySessionSourceErrorCode.InvalidReplay,
        'failed to parse replay file',
        { cause: parsedResult.error },
      )
    }

    const expiresAt = new Date(this.clock.now() + SOURCE_LIFETIME_MS)
    const source = await createReplaySessionUpload({
      ownerUserId,
      hash: fileInfo.hash,
      size: fileInfo.size,
      parserVersion: parsedResult.value.parserVersion,
      header: parsedResult.value.header,
      slots: parsedResult.value.slots,
      sbData: parsedResult.value.shieldBatteryData ?? null,
      expiresAt,
    })

    try {
      await writeFile(replaySessionUploadPath(source.id), createReadStream(filePath), {
        acl: 'private',
        type: 'application/octet-stream',
      })
    } catch (err) {
      try {
        await deleteStoredUpload(source.id)
        await deleteReplaySessionUpload(source.id)
      } catch (cleanupErr) {
        // Keep the row if object deletion fails so the expiry job can retry it.
        logger.error(
          { err: cleanupErr, sourceId: source.id },
          'failed to clean up replay upload after storage error',
        )
      }
      throw err
    }

    return toResponse(source)
  }

  /** Resolves a source only when it is still valid and belongs to the requesting user. */
  async getSourceForOwner(
    sourceId: string,
    ownerUserId: SbUserId,
  ): Promise<ReplaySessionUpload | undefined> {
    return await getReplaySessionUploadForOwner(sourceId, ownerUserId, new Date(this.clock.now()))
  }

  /**
   * Claims expired source rows before deleting their private objects. A future replay-session
   * service must extend `expiresAt` while a room still references a source.
   */
  async removeExpiredSources(): Promise<void> {
    const now = new Date(this.clock.now())
    const cleanupToken = randomUUID()
    const sourceIds = await claimExpiredReplaySessionUploads(
      now,
      new Date(now.getTime() - CLEANUP_CLAIM_LIFETIME_MS),
      cleanupToken,
    )
    const deletedIds: string[] = []
    const failedIds: string[] = []

    // Process a claimed batch sequentially so a large backlog cannot exhaust storage connections.
    for (const sourceId of sourceIds) {
      try {
        await deleteStoredUpload(sourceId)
        deletedIds.push(sourceId)
      } catch (err) {
        failedIds.push(sourceId)
        logger.error({ err, sourceId }, 'failed to delete expired replay upload file')
      }
    }

    await deleteClaimedReplaySessionUploads(deletedIds, cleanupToken, now)
    await releaseReplaySessionUploadClaims(failedIds, cleanupToken)
  }
}
