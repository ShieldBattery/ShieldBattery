import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import httpErrors from 'http-errors'
import { pipeline } from 'stream/promises'
import { singleton } from 'tsyringe'
import { GameResultErrorCode } from '../../../common/games/results'
import { SbUserId } from '../../../common/users/sb-user-id'
import { BanSource } from '../../../common/users/user-network'
import { ParsedReplay } from '../../workers/replays/messages'
import { getSignedUrl, writeFile } from '../files'
import { GameResultServiceError } from '../games/game-result-service'
import { ReplayViolationService } from '../games/replay-violation-service'
import logger from '../logging/logger'
import { setReplayFileId } from '../models/games-users'
import { BanEnacter } from '../users/ban-enacter'
import { replayPath } from './paths'
import {
  deleteReplayFile,
  findReplayByHashAndSize,
  insertReplayFile,
  REPLAY_PARSER_VERSION,
  ReplayFile,
} from './replay-models'

export interface StoreReplayContext {
  gameId: string
  userId: SbUserId
}

@singleton()
export class ReplayService {
  constructor(
    private banEnacter: BanEnacter,
    private replayViolations: ReplayViolationService,
  ) {}

  /** Validates an authenticated upload against the persisted game seed before linking its file. */
  async validateGameSeed(
    actualSeed: number,
    expectedSeed: number | undefined,
    { gameId, userId }: StoreReplayContext,
  ): Promise<void> {
    if (!Number.isInteger(actualSeed) || actualSeed < 0 || actualSeed > 0xffff_ffff) {
      throw new httpErrors.BadRequest('invalid replay')
    }
    if (expectedSeed === undefined) return
    if (!Number.isInteger(expectedSeed) || expectedSeed < 0 || expectedSeed > 0xffff_ffff) {
      throw new Error('Invalid stored game seed')
    }
    if (actualSeed === expectedSeed) return

    if (actualSeed === 0) {
      // A header with no seed at all comes from a client bug that blanks the replay recording, not
      // from a replay lifted out of another game (those carry that game's real seed).
      logger.warn({ gameId, userId, expectedSeed }, 'Replay missing its seed')
      await this.replayViolations.recordViolation({
        gameId,
        userId,
        details: { kind: 'seedMissing', expectedSeed },
      })
      throw new GameResultServiceError(
        GameResultErrorCode.ReplaySeedMissing,
        'replay is missing its seed',
      )
    }

    logger.warn({ gameId, userId, expectedSeed, actualSeed }, 'Replay seed mismatch')
    const recorded = await this.replayViolations.recordViolation({
      gameId,
      userId,
      details: { kind: 'seedMismatch', expectedSeed, actualSeed },
    })
    // Clients retry failed uploads, so only the upload that first records the violation enforces
    // it. A later retry must not re-ban a user whose ban was lifted after review.
    if (recorded) {
      await this.banEnacter.enactBan({
        targetId: userId,
        endTime: new Date('9001-01-01T00:00:00.000Z'),
        reason: 'Client integrity violation',
        source: BanSource.ClientIntegrity,
        gameId,
      })
    }
    throw new GameResultServiceError(GameResultErrorCode.ReplayRejected, 'invalid replay')
  }

  /**
   * Stores a replay file and links it to a game user record. This handles:
   * 1. Computing the file hash for deduplication
   * 2. Checking if an identical replay already exists
   * 3. Storing the file in file storage (if new)
   * 4. Inserting the database record (if new)
   * 5. Linking the replay to the user's game record
   *
   * @returns The replay file record (either existing or newly created)
   */
  async storeReplay(
    filePath: string,
    parsed: ParsedReplay,
    context: StoreReplayContext,
  ): Promise<ReplayFile> {
    const { hash, size } = await this.computeHashAndSize(filePath)

    // Check for existing replay with same hash+size (deduplication)
    const existing = await findReplayByHashAndSize(hash, size)
    if (existing) {
      // Just link to games_users, don't re-store
      await setReplayFileId(context.userId, context.gameId, existing.id)
      return existing
    }

    // Insert new replay_files record
    const replayFile = await insertReplayFile({
      hash,
      size,
      uploadedBy: context.userId,
      parserVersion: REPLAY_PARSER_VERSION,
      header: parsed.header,
      slots: parsed.slots,
      sbData: parsed.shieldBatteryData ?? null,
    })

    // Store the actual file
    try {
      await this.storeReplayFile(replayFile.id, filePath)
    } catch (err) {
      // Best effort cleanup of the DB record if file storage fails
      deleteReplayFile(replayFile.id).catch(cleanupErr => {
        logger.error(
          { err: cleanupErr },
          'failed to clean up replay file record after storage error',
        )
      })
      throw err
    }

    // Link to games_users
    await setReplayFileId(context.userId, context.gameId, replayFile.id)

    return replayFile
  }

  private async storeReplayFile(id: string, filePath: string): Promise<void> {
    const path = replayPath(id)
    const stream = createReadStream(filePath)
    await writeFile(path, stream, {
      acl: 'private',
      type: 'application/octet-stream',
    })
  }

  private async computeHashAndSize(filePath: string): Promise<{ hash: Buffer; size: number }> {
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

  /**
   * Generates a signed URL for downloading a replay file.
   * @param replayFileId The ID of the replay file
   * @param filename The filename to use for the download (without extension)
   * @param expiresIn Expiry time in seconds (default: 24 hours)
   */
  async getReplayDownloadUrl(
    replayFileId: string,
    filename: string,
    expiresIn = 24 * 60 * 60,
  ): Promise<string> {
    const path = replayPath(replayFileId)
    return getSignedUrl(path, {
      expires: expiresIn,
      contentDisposition: `attachment; filename="${filename}.rep"`,
    })
  }
}
