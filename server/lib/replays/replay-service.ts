import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { pipeline } from 'stream/promises'
import { singleton } from 'tsyringe'
import { SbUserId } from '../../../common/users/sb-user-id'
import { ParsedReplay } from '../../workers/replays/messages'
import { writeFile } from '../files'
import logger from '../logging/logger'
import { setReplayFileId } from '../models/games-users'
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
}
