import KoaRouter from '@koa/router'
import httpErrors from 'http-errors'
import { container } from 'tsyringe'
import { GameRecord } from '../../../common/games/games'
import { MapExtension, SbMapId } from '../../../common/maps'
import { urlPath } from '../../../common/urls'
import { SbUserId } from '../../../common/users/sb-user-id'
import { readFile } from '../files'
import { setInternalResponseHeaders } from '../http/internal-response-headers'
import { getMapInfos } from '../maps/map-models'
import { mapPath } from '../maps/paths'
import { NetcodeV2Service } from '../netcode-v2/netcode-v2-service'
import { replayPath } from '../replays/paths'
import { getAllReplaysForGame } from '../replays/replay-models'
import { getGameRecord, getNetcodeV2Session } from './game-models'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RELAY_ID_REGEX = /^(0|[1-9][0-9]{0,9})$/

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
  /** SHA-256 of the map file, hex-encoded. */
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

async function getGameOr404(gameId: string): Promise<GameRecord> {
  // The id column is a Postgres `uuid`, so a malformed id would error inside the query rather
  // than return no rows. Checking the shape here keeps that from turning into a 500, and callers
  // can't distinguish a malformed id from an unknown one.
  if (!UUID_REGEX.test(gameId)) {
    throw new httpErrors.NotFound('Game not found')
  }
  const game = await getGameRecord(gameId)
  if (!game) {
    throw new httpErrors.NotFound('Game not found')
  }
  return game
}

/**
 * Returns the game's netcode v2 session id, or undefined if the game has no session (or netcode v2
 * is disabled, in which case nothing could be fetched for a session anyway).
 */
async function getNetcodeV2SessionIfEnabled(
  netcodeV2Service: NetcodeV2Service,
  gameId: string,
): Promise<number | undefined> {
  if (!netcodeV2Service.isEnabled()) {
    return undefined
  }
  const session = await getNetcodeV2Session(gameId)
  return session ?? undefined
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
 * Registers the game artifact routes for service-to-service callers, relative to the internal
 * router's mount:
 *
 * - `GET /games/:gameId/artifacts` lists what's stored for a game (see
 *   `InternalGameArtifactsResponseJson`)
 * - `GET /games/:gameId/artifacts/flight-recordings/:relayId` downloads one relay's flight
 *   recording as JSON
 * - `GET /games/:gameId/artifacts/replays/:replayId` downloads one uploaded replay file
 * - `GET /games/:gameId/artifacts/map` downloads the map file the game was played on
 *
 * No application-level authentication is required — reachability is restricted to the private
 * network/tailnet by the internal router's mounting; see internal-routes.ts.
 *
 * Every download route re-derives what it serves from the game id (the coordinator session, the
 * replay ids that belong to the game, the map object key), so a caller can only ever name a game
 * and pick among the artifacts that game owns, never supply a storage key or session of its own.
 * Artifacts are proxied through this server rather than handed out as signed object-store URLs so
 * the network stays the only authorization boundary: a signed URL is a bearer credential that
 * could leak wherever the caller logs or forwards it, and flight recordings live in the
 * coordinator's store (behind our tenant key) with no signed-GET flow at all.
 */
export function registerInternalGameArtifactRoutes(router: KoaRouter) {
  router.get('/games/:gameId/artifacts', async ctx => {
    const game = await getGameOr404(ctx.params.gameId)
    const netcodeV2Service = container.resolve(NetcodeV2Service)

    const [session, replays, map] = await Promise.all([
      getNetcodeV2SessionIfEnabled(netcodeV2Service, game.id),
      getAllReplaysForGame(game.id),
      getMapArtifact(game),
    ])
    const blobs = session !== undefined ? await netcodeV2Service.listFlightBlobs(session) : []

    setInternalResponseHeaders(ctx)
    const response: InternalGameArtifactsResponseJson = {
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
    ctx.body = response
  })

  router.get('/games/:gameId/artifacts/flight-recordings/:relayId', async ctx => {
    const relayIdParam: string = ctx.params.relayId
    if (!RELAY_ID_REGEX.test(relayIdParam)) {
      throw new httpErrors.NotFound('No flight recording for that relay')
    }
    const relayId = Number(relayIdParam)

    const game = await getGameOr404(ctx.params.gameId)
    const netcodeV2Service = container.resolve(NetcodeV2Service)
    const session = await getNetcodeV2SessionIfEnabled(netcodeV2Service, game.id)
    if (session === undefined) {
      throw new httpErrors.NotFound('Game has no netcode v2 session')
    }

    const blob = await netcodeV2Service.fetchFlightBlob(session, relayId)
    if (blob === undefined) {
      throw new httpErrors.NotFound('No flight recording for that relay')
    }

    setInternalResponseHeaders(ctx)
    ctx.set('Content-Type', 'application/json')
    ctx.set('Content-Disposition', `attachment; filename="${game.id}-relay-${relayId}.json"`)
    ctx.body = blob
  })

  router.get('/games/:gameId/artifacts/replays/:replayId', async ctx => {
    const replayIdParam: string = ctx.params.replayId
    if (!UUID_REGEX.test(replayIdParam)) {
      throw new httpErrors.NotFound('Replay not found')
    }
    const replayId = replayIdParam.toLowerCase()

    const game = await getGameOr404(ctx.params.gameId)
    // Looked up through the game (rather than by replay id directly) so only replays this game
    // owns can be fetched via this game's URL.
    const replays = await getAllReplaysForGame(game.id)
    const replay = replays.find(r => r.id === replayId)
    if (!replay) {
      throw new httpErrors.NotFound('Replay not found')
    }

    // Replay uploads are capped at 5 MiB (see MAX_REPLAY_SIZE_BYTES in game-api.ts), so buffering
    // the whole file is fine.
    const bytes = await readFile(replayPath(replay.id))

    setInternalResponseHeaders(ctx)
    ctx.set('Content-Type', 'application/octet-stream')
    ctx.set('Content-Disposition', `attachment; filename="${replay.id}.rep"`)
    ctx.body = bytes
  })

  router.get('/games/:gameId/artifacts/map', async ctx => {
    const game = await getGameOr404(ctx.params.gameId)
    const map = await getMapArtifact(game)
    if (!map) {
      throw new httpErrors.NotFound('Map not found')
    }

    // Maps can be up to 100 MiB (see MAX_MAP_FILE_SIZE_BYTES), so this is the one artifact whose
    // buffering is noticeable. The file store only offers whole-file reads, and the callers here
    // are a handful of trusted services rather than the public, so that's tolerated; a streaming
    // FileStore read would remove the peak if it ever matters.
    const bytes = await readFile(mapPath(map.hash, map.format))

    setInternalResponseHeaders(ctx)
    ctx.set('Content-Type', 'application/octet-stream')
    ctx.set('Content-Disposition', `attachment; filename="${map.hash}.${map.format}"`)
    ctx.body = bytes
  })
}
