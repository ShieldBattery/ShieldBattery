import { RouterContext } from '@koa/router'
import Joi from 'joi'
import { nanoid } from 'nanoid'
import { randomUUID } from 'node:crypto'
import { GameServerRegionId } from '../../../common/game-server-regions'
import { GameSetup, PlayerInfo } from '../../../common/games/game-launch-config'
import { GameLoaderEvent } from '../../../common/games/game-loader-network'
import { GameType } from '../../../common/games/game-type'
import { SlotType } from '../../../common/lobbies/slot'
import { BwUserLatency } from '../../../common/network'
import { SbUserId } from '../../../common/users/sb-user-id'
import isDev from '../env/is-dev'
import { gameUserPath } from '../games/game-loader'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpPost } from '../http/route-decorators'
import log from '../logging/logger'
import { NetcodeV2Service } from '../netcode-v2/netcode-v2-service'
import ensureLoggedIn from '../session/ensure-logged-in'
import { findUsersById } from '../users/user-model'
import { validateRequest } from '../validation/joi-validator'
import { ClientSocketsGroup, ClientSocketsManager } from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'

/** How long a launch may spend waiting on the coordinator to mint its netcode v2 session. */
const CREATE_SESSION_TIMEOUT_MS = 120_000

/** Hides every route behind it as if it doesn't exist at all when the server isn't in development. */
async function ensureDevOnly(ctx: RouterContext, next: () => Promise<void>): Promise<void> {
  if (!isDev) {
    ctx.throw(404)
  }
  await next()
}

/**
 * A per-session Ed25519 public key, base64-encoded, matching the format the netcode v2 coordinator
 * expects for a rally-point2 slot.
 */
const clientPubkeySchema = Joi.string()
  .base64()
  .max(64)
  .custom((value, helpers) =>
    Buffer.from(value, 'base64').length === 32 ? value : helpers.error('any.invalid'),
  )
  .required()

interface DevReplaySessionMember {
  client: ClientSocketsGroup
  clientPubkey: string
  replayPath: string
  /** The home region the member's relay is placed in, resolved the way a lobby join does. */
  region?: GameServerRegionId
  rttMs?: number
  regionManual?: boolean
}

/** A group of clients that have declared intent to join the same dev replay session. */
interface DevReplaySession {
  /** The number of members this session launches with, fixed by whichever join created it. */
  size: number
  members: Map<SbUserId, DevReplaySessionMember>
}

/**
 * A development-only launcher that puts several already-logged-in clients into a single
 * relay-backed replay playback: no lobby, no `games` row, no results, and no access checks. It
 * exists so the game DLL's multi-watcher replay path can be exercised by pointing a handful of dev
 * clients at the same session id, each with its own local copy of the replay file. Every client
 * that joins a given session id is remembered until as many have joined as the session's first
 * joiner declared, at which point the whole group is launched together against one netcode v2 relay
 * session. Not registered outside development.
 */
@httpApi('/dev/replay-sessions')
@httpBeforeAll(ensureLoggedIn, ensureDevOnly)
export class DevReplaySessionApi {
  private sessions = new Map<string, DevReplaySession>()

  constructor(
    private clientSocketsManager: ClientSocketsManager,
    private publisher: TypedPublisher<GameLoaderEvent>,
    private netcodeV2Service: NetcodeV2Service,
  ) {}

  @httpPost('/:sessionId/join')
  async join(ctx: RouterContext): Promise<{ sessionId: string; joined: number; size: number }> {
    const { params, body } = validateRequest(ctx, {
      params: Joi.object<{ sessionId: string }>({
        sessionId: Joi.string().min(1).max(64).required(),
      }),
      body: Joi.object<{
        clientId: string
        clientPubkey: string
        replayPath: string
        size: number
        region?: GameServerRegionId
        rttMs?: number
        regionManual?: boolean
      }>({
        clientId: Joi.string().required(),
        clientPubkey: clientPubkeySchema,
        replayPath: Joi.string().min(1).max(1024).required(),
        size: Joi.number().integer().min(1).max(8).required(),
        region: Joi.string().max(64),
        rttMs: Joi.number().min(0),
        regionManual: Joi.boolean(),
      }),
    })

    if (!this.netcodeV2Service.isEnabled()) {
      ctx.throw(503, 'netcode v2 is not configured on this server; dev replay sessions need it')
    }

    const userId = ctx.session!.user.id
    const client = this.clientSocketsManager.getById(userId, body.clientId)
    if (!client) {
      ctx.throw(400, 'no socket connection for that client')
    }

    let session = this.sessions.get(params.sessionId)
    if (!session) {
      session = { size: body.size, members: new Map() }
      this.sessions.set(params.sessionId, session)
    }
    session.members.set(userId, {
      client,
      clientPubkey: body.clientPubkey,
      replayPath: body.replayPath,
      region: body.region,
      rttMs: body.rttMs,
      regionManual: body.regionManual,
    })

    const joined = session.members.size
    const size = session.size
    if (joined >= size) {
      this.sessions.delete(params.sessionId)
      const members = Array.from(session.members, ([memberUserId, member]) => ({
        userId: memberUserId,
        ...member,
      }))
      this.launch(members).catch(err => {
        // A coordinator refusal explains itself in its response body, which the wrapping error's
        // message leaves out.
        const cause = err instanceof Error ? err.cause : undefined
        const coordinatorResponse = (cause as { response?: { body?: unknown } } | undefined)
          ?.response?.body
        log.error({ err, coordinatorResponse }, 'dev replay session launch failed')
      })
    }

    return { sessionId: params.sessionId, joined, size }
  }

  private async launch(
    members: ReadonlyArray<{ userId: SbUserId } & DevReplaySessionMember>,
  ): Promise<void> {
    const gameId = randomUUID()
    const users = await findUsersById(members.map(m => m.userId))

    const slots: PlayerInfo[] = members.map(m => ({
      id: nanoid(),
      type: SlotType.Human,
      typeId: 6,
      teamId: 0,
      userId: m.userId,
    }))
    const host = slots[0]

    for (const member of members) {
      member.client.subscribe(gameUserPath(gameId, member.userId))
      const setup: GameSetup = {
        gameId,
        name: 'ShieldBattery Replay Session',
        map: { isReplay: true, path: member.replayPath },
        gameType: GameType.Melee,
        gameSubType: 0,
        slots,
        host,
        users,
        seed: 0,
        turnRate: 24,
        userLatency: BwUserLatency.Low,
        useNetcodeV2: true,
      }
      this.publisher.publish(gameUserPath(gameId, member.userId), {
        type: 'setGameConfig',
        gameId,
        setup,
      })
    }

    const created = await this.netcodeV2Service.createSessionForGame({
      gameId,
      slots: members.map((m, i) => ({
        slot: i,
        userId: m.userId,
        // The host is the session's one non-observer slot: an observer slot's command bytes
        // are not forwarded to the other slots, and the host's replay controls have to reach
        // every watcher.
        observer: i !== 0,
        region: m.region,
        rttMs: m.rttMs,
        regionManual: m.regionManual,
        pubkey: m.clientPubkey,
      })),
      signal: AbortSignal.timeout(CREATE_SESSION_TIMEOUT_MS),
    })

    for (const [userId, setup] of created.setups) {
      this.publisher.publish(gameUserPath(gameId, userId), {
        type: 'setNetcodeV2Setup',
        gameId,
        setup,
      })
    }
  }
}
