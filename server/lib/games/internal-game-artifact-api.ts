import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import { Readable } from 'stream'
import { GameRecord } from '../../../common/games/games'
import { MapExtension, SbMapId } from '../../../common/maps'
import { urlPath } from '../../../common/urls'
import { SbUserId } from '../../../common/users/sb-user-id'
import { readFileStream } from '../files'
import { setAttachmentHeaders } from '../http/attachment-headers'
import { httpBeforeAll, internalApi } from '../http/http-api'
import { internalResponseHeaders } from '../http/internal-response-headers'
import { httpGet } from '../http/route-decorators'
import { getMapInfos } from '../maps/map-models'
import { mapPath } from '../maps/paths'
import { NetcodeV2Service } from '../netcode-v2/netcode-v2-service'
import { replayPath } from '../replays/paths'
import { getAllReplaysForGame } from '../replays/replay-models'
import { validateRequest } from '../validation/joi-validator'
import { getGameRecord, getNetcodeV2Session } from './game-models'

export interface InternalFlightRecordingArtifactJson {
  relayId: number
  /** Whether the recording is in the pinned (desynced-session) retention class. */
  pinned: boolean
  /**
   * The stored blob's size in bytes: the *compressed* size at rest. The JSON the download route
   * returns is the decompressed recording and can be considerably larger.
   */
  size: number
  /** When the blob was stored, unix-epoch milliseconds. */
  lastModifiedMs: number
  /** Absolute path (on this server) that downloads the recording as JSON. */
  downloadPath: string
}

export interface InternalReplayArtifactJson {
  id: string
  /** The user whose client uploaded this replay of the game. */
  uploaderUserId: SbUserId
  /** Size of the replay file in bytes. */
  size: number
  /** SHA-256 of the replay file, hex-encoded. */
  sha256: string
  /** Number of game frames the replay covers, if its header parsed. */
  frames: number | null
  /** Absolute path (on this server) that downloads the replay file. */
  downloadPath: string
}

export interface InternalMapArtifactJson {
  id: SbMapId
  /**
   * The map's identity hash, hex-encoded: SHA-256 over the format string (`scx`/`scm`) followed by
   * the file bytes, as the game client computes it to match a local map file. Not a plain hash of
   * the file.
   */
  hash: string
  format: MapExtension
  name: string
  /** Absolute path (on this server) that downloads the map file. */
  downloadPath: string
}

/**
 * Response shape for `GET /internal/games/:gameId/artifacts`: everything stored for a game that a
 * machine caller might want to pull for diagnosis, each with the internal path that serves it.
 * Only metadata is returned here; the artifacts themselves can be large, so callers fetch just the
 * ones they need.
 */
export interface InternalGameArtifactsResponseJson {
  gameId: string
  /**
   * The flight recordings the netcode v2 coordinator holds for this game's session, one per relay
   * that served it. Empty when the game had no netcode v2 session (or netcode v2 is disabled).
   */
  flightRecordings: InternalFlightRecordingArtifactJson[]
  /** Every replay uploaded for this game, longest first. */
  replays: InternalReplayArtifactJson[]
  /** The map the game was played on, or null if its record no longer exists. */
  map: InternalMapArtifactJson | null
}

const GAME_ID_PARAMS = Joi.object<{ gameId: string }>({
  gameId: Joi.string().uuid().required(),
})

const FLIGHT_RECORDING_PARAMS = Joi.object<{ gameId: string; relayId: number }>({
  gameId: Joi.string().uuid().required(),
  relayId: Joi.number().integer().min(0).required(),
})

const REPLAY_PARAMS = Joi.object<{ gameId: string; replayId: string }>({
  gameId: Joi.string().uuid().required(),
  replayId: Joi.string().uuid().lowercase().required(),
})

async function getGameOr404(gameId: string): Promise<GameRecord> {
  const game = await getGameRecord(gameId)
  if (!game) {
    throw new httpErrors.NotFound('Game not found')
  }
  return game
}

async function getMapArtifact(game: GameRecord): Promise<InternalMapArtifactJson | null> {
  const [map] = await getMapInfos([game.mapId])
  if (!map) {
    return null
  }
  return {
    id: map.id,
    hash: map.hash,
    format: map.mapData.format,
    name: map.name,
    downloadPath: urlPath`/internal/games/${game.id}/artifacts/map`,
  }
}

/**
 * Game artifact access for service-to-service callers: a manifest of what's stored for a game, and
 * a download route per artifact. No application-level authentication is required; reachability is
 * restricted to the private network/tailnet by the internal mount, see internal-routes.ts.
 *
 * Every download route re-derives what it serves from the game id (the coordinator session, the
 * replay ids that belong to the game, the map object key), so a caller can only ever name a game
 * and pick among the artifacts that game owns, never supply a storage key or session of its own.
 * Artifacts are proxied through this server rather than handed out as signed object-store URLs so
 * the network stays the only authorization boundary: a signed URL is a bearer credential that
 * could leak wherever the caller logs or forwards it, and flight recordings live in the
 * coordinator's store (behind our tenant key) with no signed-GET flow at all.
 */
@internalApi('/games')
@httpBeforeAll(internalResponseHeaders)
export class InternalGameArtifactApi {
  constructor(private netcodeV2Service: NetcodeV2Service) {}

  /**
   * Returns the game's netcode v2 session id, or undefined if the game has no session (or netcode
   * v2 is disabled, in which case nothing could be fetched for a session anyway).
   */
  private async getNetcodeV2SessionIfEnabled(gameId: string): Promise<number | undefined> {
    if (!this.netcodeV2Service.isEnabled()) {
      return undefined
    }
    const session = await getNetcodeV2Session(gameId)
    return session ?? undefined
  }

  @httpGet('/:gameId/artifacts')
  async listArtifacts(ctx: RouterContext): Promise<InternalGameArtifactsResponseJson> {
    const {
      params: { gameId },
    } = validateRequest(ctx, { params: GAME_ID_PARAMS })
    const game = await getGameOr404(gameId)

    const [session, replays, map] = await Promise.all([
      this.getNetcodeV2SessionIfEnabled(game.id),
      getAllReplaysForGame(game.id),
      getMapArtifact(game),
    ])
    const blobs = session !== undefined ? await this.netcodeV2Service.listFlightBlobs(session) : []

    return {
      gameId: game.id,
      flightRecordings: blobs.map(b => ({
        relayId: b.relayId,
        pinned: b.pinned,
        size: b.size,
        lastModifiedMs: b.lastModifiedMs,
        downloadPath: urlPath`/internal/games/${game.id}/artifacts/flight-recordings/${b.relayId}`,
      })),
      replays: replays.map(r => ({
        id: r.id,
        uploaderUserId: r.uploadedByGameUserId,
        size: r.size,
        sha256: r.hash.toString('hex'),
        frames: r.header?.frames ?? null,
        downloadPath: urlPath`/internal/games/${game.id}/artifacts/replays/${r.id}`,
      })),
      map,
    }
  }

  @httpGet('/:gameId/artifacts/flight-recordings/:relayId')
  async getFlightRecording(ctx: RouterContext): Promise<string> {
    const {
      params: { gameId, relayId },
    } = validateRequest(ctx, { params: FLIGHT_RECORDING_PARAMS })
    const game = await getGameOr404(gameId)

    const session = await this.getNetcodeV2SessionIfEnabled(game.id)
    if (session === undefined) {
      throw new httpErrors.NotFound('Game has no netcode v2 session')
    }
    const blob = await this.netcodeV2Service.fetchFlightBlob(session, relayId)
    if (blob === undefined) {
      throw new httpErrors.NotFound('No flight recording for that relay')
    }

    setAttachmentHeaders(ctx, {
      contentType: 'application/json',
      filename: `${game.id}-relay-${relayId}.json`,
    })
    return blob
  }

  @httpGet('/:gameId/artifacts/replays/:replayId')
  async getReplay(ctx: RouterContext): Promise<Readable> {
    const {
      params: { gameId, replayId },
    } = validateRequest(ctx, { params: REPLAY_PARAMS })
    const game = await getGameOr404(gameId)

    // Looked up through the game (rather than by replay id directly) so only replays this game
    // owns can be fetched via this game's URL.
    const replays = await getAllReplaysForGame(game.id)
    const replay = replays.find(r => r.id === replayId)
    if (!replay) {
      throw new httpErrors.NotFound('Replay not found')
    }

    const file = await readFileStream(replayPath(replay.id))
    setAttachmentHeaders(ctx, {
      contentType: 'application/octet-stream',
      filename: `${replay.id}.rep`,
      length: file.size,
    })
    return file.stream
  }

  @httpGet('/:gameId/artifacts/map')
  async getMap(ctx: RouterContext): Promise<Readable> {
    const {
      params: { gameId },
    } = validateRequest(ctx, { params: GAME_ID_PARAMS })
    const game = await getGameOr404(gameId)

    const map = await getMapArtifact(game)
    if (!map) {
      throw new httpErrors.NotFound('Map not found')
    }

    const file = await readFileStream(mapPath(map.hash, map.format))
    setAttachmentHeaders(ctx, {
      contentType: 'application/octet-stream',
      filename: `${map.hash}.${map.format}`,
      length: file.size,
    })
    return file.stream
  }
}
