import { singleton } from 'tsyringe'
import {
  GetReplaySessionSourceResponse,
  ReplaySessionSource,
  ReplaySessionSourceInfo,
} from '../../../common/replay-sessions'
import { SbUserId } from '../../../common/users/sb-user-id'
import { CodedError } from '../errors/coded-error'
import { getSignedUrl } from '../files'
import { getGameRecord } from '../games/game-models'
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
 * Resolves the replays users ask to watch with others and decides who may download them. A
 * ShieldBattery game's replay follows the game's own replay access rules for every viewer
 * individually, so being invited to watch never grants access to a replay the viewer couldn't
 * download themselves. An uploaded replay is shared with whoever its owner watches it with.
 */
@singleton()
export class ReplaySessionSources {
  constructor(private sourceService: ReplaySessionSourceService) {}

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

      return {
        source: {
          kind: 'upload',
          sourceId: upload.id,
          hash: upload.hash.toString('hex'),
          size: upload.size,
        },
        info: { kind: 'upload', metadata: replaySessionSourceMetadata(upload.header) },
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
        metadata: replaySessionSourceMetadata(replay.header),
      },
    }
  }

  /** Whether `userId` may watch a resolved replay. */
  async canAccess(source: ResolvedReplaySessionSource, userId: SbUserId): Promise<boolean> {
    if (source.kind === 'upload') {
      return true
    }

    const game = await getGameRecord(source.gameId)
    return !!game && canUserAccessReplay(game, userId)
  }

  /** Returns a short-lived download URL for a resolved replay, if `userId` may watch it. */
  async download(
    source: ResolvedReplaySessionSource,
    userId: SbUserId,
  ): Promise<GetReplaySessionSourceResponse> {
    if (!(await this.canAccess(source, userId))) {
      throw new ReplaySessionSourceAccessError(
        ReplaySessionSourceAccessErrorCode.NotAccessible,
        'you cannot access this replay',
      )
    }

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
