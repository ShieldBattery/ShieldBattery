import { Worker } from 'node:worker_threads'
import { singleton } from 'tsyringe'
import { MapImageInfo } from '../../../common/maps'
import {
  GetReplaySessionSourceResponse,
  ReplaySessionSource,
  ReplaySessionSourceInfo,
} from '../../../common/replay-sessions'
import { SbUserId } from '../../../common/users/sb-user-id'
import { CodedError } from '../errors/coded-error'
import { getSignedUrl, readFile } from '../files'
import { getGameRecord } from '../games/game-models'
import logger from '../logging/logger'
import { getMapInfos } from '../maps/map-models'
import { replayPath } from './paths'
import { canUserAccessReplay } from './replay-access'
import { getBestReplayForGame } from './replay-models'
import {
  replaySessionSourceMetadata,
  ReplaySessionSourceService,
  replaySessionUploadPath,
} from './replay-session-source-service'

export enum ReplaySessionSourceAccessErrorCode {
  NotAccessible = 'NotAccessible',
  NotFound = 'NotFound',
}

export class ReplaySessionSourceAccessError extends CodedError<ReplaySessionSourceAccessErrorCode> {}

/** How long a viewer's replay download URL stays valid. */
const DOWNLOAD_URL_LIFETIME_SECONDS = 5 * 60

/**
 * A replay chosen to be watched with others, fixed when it is chosen so that every viewer downloads
 * and verifies the same bytes. Holds the private details (which stored file, which staged upload)
 * that viewers never see.
 */
export type ResolvedReplaySessionSource =
  | { kind: 'game'; gameId: string; replayFileId: string; hash: string; size: number }
  | { kind: 'upload'; sourceId: string; hash: string; size: number }

/**
 * Resolves the replays users ask to watch with others. The host must be allowed to select a game
 * replay. Once selected, lobby membership grants session access to its bytes, including when the
 * game is unlisted and the lobby is public.
 */
@singleton()
export class ReplaySessionSources {
  constructor(private sourceService: ReplaySessionSourceService) {}

  private readonly thumbnailCache = new Map<string, Promise<Buffer | undefined>>()

  /** Renders the map embedded in a replay when no library map image is available. */
  async thumbnail(source: ResolvedReplaySessionSource): Promise<Buffer | undefined> {
    if (!process.env.SB_SPRITE_DATA) return undefined
    const cached = this.thumbnailCache.get(source.hash)
    if (cached) return cached
    const render = this.renderThumbnail(source).catch(err => {
      logger.warn({ err, replayHash: source.hash }, 'failed to render replay map thumbnail')
      this.thumbnailCache.delete(source.hash)
      return undefined
    })
    this.thumbnailCache.set(source.hash, render)
    if (this.thumbnailCache.size > 16) {
      this.thumbnailCache.delete(this.thumbnailCache.keys().next().value!)
    }
    return render
  }

  private async renderThumbnail(source: ResolvedReplaySessionSource): Promise<Buffer | undefined> {
    const path =
      source.kind === 'game'
        ? replayPath(source.replayFileId)
        : replaySessionUploadPath(source.sourceId)
    const replayBytes = await readFile(path)
    return await new Promise<Buffer | undefined>((resolve, reject) => {
      const worker = new Worker(require.resolve('./replay-map-image-worker'), {
        name: 'replay-map-image-worker',
        workerData: { replayBytes, bwDataPath: process.env.SB_SPRITE_DATA },
      })
      const timeout = setTimeout(() => {
        worker.terminate().catch(() => {})
        reject(new Error('timed out rendering replay map'))
      }, 60000)
      worker.once('message', (message: { image?: Uint8Array; error?: string }) => {
        clearTimeout(timeout)
        if (message.error) reject(new Error(message.error))
        else resolve(message.image ? Buffer.from(message.image) : undefined)
      })
      worker.once('error', err => {
        clearTimeout(timeout)
        reject(err instanceof Error ? err : new Error(String(err)))
      })
      worker.once('exit', code => {
        if (code !== 0) {
          clearTimeout(timeout)
          reject(new Error(`replay map image worker exited with ${code}`))
        }
      })
    })
  }

  private async mapImageForGame(gameId: string | undefined): Promise<MapImageInfo | undefined> {
    if (!gameId) return undefined
    const game = await getGameRecord(gameId)
    if (!game?.mapId) return undefined
    const map = (await getMapInfos([game.mapId]))[0]
    if (!map) return undefined
    return {
      name: map.name,
      image256Url: map.image256Url,
      image512Url: map.image512Url,
      image1024Url: map.image1024Url,
      image2048Url: map.image2048Url,
      mapData: { width: map.mapData.width, height: map.mapData.height },
    }
  }

  /**
   * Resolves the replay `userId` asked to watch, keeping an uploaded replay alive for another full
   * source lifetime.
   */
  async resolve(
    source: ReplaySessionSource,
    userId: SbUserId,
  ): Promise<{ source: ResolvedReplaySessionSource; info: ReplaySessionSourceInfo }> {
    if (source.kind === 'upload') {
      const upload = await this.sourceService.retainSourceForOwner(source.sourceId, userId)
      if (!upload) {
        throw new ReplaySessionSourceAccessError(
          ReplaySessionSourceAccessErrorCode.NotFound,
          'that replay could not be found',
        )
      }

      const mapImage = await this.mapImageForGame(upload.sbData?.gameId)
      return {
        source: {
          kind: 'upload',
          sourceId: upload.id,
          hash: upload.hash.toString('hex'),
          size: upload.size,
        },
        info: {
          kind: 'upload',
          metadata: { ...replaySessionSourceMetadata(upload.header, upload.slots), mapImage },
        },
      }
    }

    const game = await getGameRecord(source.gameId)
    if (!game || !canUserAccessReplay(game, userId)) {
      throw new ReplaySessionSourceAccessError(
        ReplaySessionSourceAccessErrorCode.NotAccessible,
        'you cannot access this replay',
      )
    }
    const replay = await getBestReplayForGame(source.gameId)
    if (!replay) {
      throw new ReplaySessionSourceAccessError(
        ReplaySessionSourceAccessErrorCode.NotFound,
        'that game has no replay',
      )
    }

    const mapImage = await this.mapImageForGame(source.gameId)
    return {
      source: {
        kind: 'game',
        gameId: source.gameId,
        replayFileId: replay.id,
        hash: replay.hash.toString('hex'),
        size: replay.size,
      },
      info: {
        kind: 'game',
        gameId: source.gameId,
        metadata: { ...replaySessionSourceMetadata(replay.header, replay.slots), mapImage },
      },
    }
  }

  /** Returns a short-lived URL after the lobby service has checked membership. */
  async download(source: ResolvedReplaySessionSource): Promise<GetReplaySessionSourceResponse> {
    const path =
      source.kind === 'game'
        ? replayPath(source.replayFileId)
        : replaySessionUploadPath(source.sourceId)
    const url = await getSignedUrl(path, {
      expires: DOWNLOAD_URL_LIFETIME_SECONDS,
      contentType: 'application/octet-stream',
    })

    return { url, hash: source.hash, size: source.size }
  }

  /**
   * Keeps the uploaded replays still being watched alive, returning the ids that were retained. An
   * id missing from the result had already expired.
   */
  async retainUploads(sourceIds: ReadonlyArray<string>): Promise<Set<string>> {
    return await this.sourceService.retainSources(sourceIds)
  }
}
