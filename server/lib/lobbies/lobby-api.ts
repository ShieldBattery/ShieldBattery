import { RouterContext } from '@koa/router'
import Joi from 'joi'
import { container } from 'tsyringe'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { isValidLobbyName } from '../../../common/constants'
import { ALL_GAME_TYPES } from '../../../common/games/game-type'
import { ALL_LOBBY_VISIBILITIES, MAX_MAP_QUEUE } from '../../../common/lobbies'
import {
  CreateLobbyRequest,
  CreateLobbyResponse,
  GetLobbyStateResponse,
  JoinLobbyRequest,
  LobbyClientRequest,
  LobbyJoinErrorCode,
  LobbyServiceErrorCode,
  LobbySlotRequest,
  MoveSlotRequest,
  ReportLobbyReplayFrameRequest,
  ReportLobbyReplayLoadedRequest,
  ReportLobbyReplaySeekReachedRequest,
  ReportLobbyReplaySeekRequest,
  ReportLobbyReplaySpeedRequest,
  SendLobbyChatRequest,
  SendLobbyOutcomeRequest,
  SetLobbyRaceRequest,
  SetLobbyReadyRequest,
  StartLobbyCountdownRequest,
  UpdateLobbySettingsRequest,
} from '../../../common/lobbies/lobby-network'
import { SbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import { isPrettyId } from '../../../common/pretty-id'
import { ALL_RACE_CHARS } from '../../../common/races'
import {
  GetReplaySessionSourceResponse,
  ReplaySessionSource,
} from '../../../common/replay-sessions'
import { SbUserId } from '../../../common/users/sb-user-id'
import { makeErrorConverterMiddleware } from '../errors/coded-error'
import { asHttpError, HttpErrorWithPayload } from '../errors/error-with-payload'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpBefore, httpGet, httpPost } from '../http/route-decorators'
import { ROLLED_OUTCOME_REQUEST_KEYS } from '../messaging/rolled-outcome-request-schema'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware, { throttleByUser } from '../throttle/middleware'
import { validateRequest } from '../validation/joi-validator'
import {
  ClientSocketsGroup,
  ClientSocketsManager,
  UserSocketsGroup,
} from '../websockets/socket-groups'
import { LobbyService, LobbyServiceError } from './lobby-service'
import { ReplayLobbySourceRetentionJob } from './replay-lobby-source-retention'

// Creating, joining, and leaving are one-off transitions in and out of a lobby, so a
// matchmaking-like rate is plenty. Leaving deliberately sits here rather than on the in-lobby
// bucket: a user still in a lobby is barred from every other gameplay activity, so an errant
// client burning the in-lobby bucket must never leave them unable to get out.
const lobbyThrottle = createThrottle('lobbies', {
  rate: 20,
  burst: 40,
  window: 60000,
})

// The in-lobby operations, on the other hand, are ordinary clicks in the lobby UI (moving between
// slots, flipping slots open and closed while setting a game up), so they get a lot more headroom.
const lobbyActionThrottle = createThrottle('lobbies/action', {
  rate: 40,
  burst: 120,
  window: 60000,
})

// Chat sends share channel chat's rate: far beyond human typing speed, but a cap on the mention
// processing and occupant fan-out every message costs.
const lobbyChatThrottle = createThrottle('lobbies/chat', {
  rate: 30,
  burst: 90,
  window: 60000,
})

// Koa mounts every API sharing a base path onto the same prefix, and a router's `use` middleware
// runs for every request under that prefix -- including ones only a *sibling* class has a route
// for. `/lobbies` is also served by the deliberately unauthenticated `LobbySummaryApi`, so the login
// check has to be attached per route here rather than to the class, or it would guard that endpoint
// too.
const authed = [ensureLoggedIn, throttleMiddleware(lobbyThrottle, throttleByUser)]
const authedAction = [ensureLoggedIn, throttleMiddleware(lobbyActionThrottle, throttleByUser)]

/** Validates a route's `:lobbyId` as a well-formed lobby id. */
const lobbyIdParams = Joi.object<{ lobbyId: SbLobbyId }>({
  lobbyId: Joi.string()
    .custom((value, helpers) => (isPrettyId(value) ? value : helpers.error('any.invalid')))
    .required(),
})

/** Identifies the acting client session, which is what a lobby's membership is keyed on. */
const clientIdSchema = Joi.string().required()

/**
 * The desired region is an opaque id, loosely validated here; the service checks it against the live
 * region list and drops it if unknown, so a client with no measured regions creates/joins
 * region-less. `rttMs` is only meaningful alongside a region, which is what actually gates it.
 */
const regionSchema = Joi.string().max(64)
const rttMsSchema = Joi.number().min(0)
/** Whether the region was hand-picked rather than resolved from measurements; diagnostics only. */
const regionManualSchema = Joi.boolean()
/**
 * The per-session netcode v2 public key is optional (a solo-vs-AI lobby never uses netcode v2), but
 * when present it must decode to exactly 32 raw bytes (an Ed25519 public key).
 */
const clientPubkeySchema = Joi.string()
  .base64()
  .max(64)
  .custom((value, helpers) =>
    Buffer.from(value, 'base64').length === 32 ? value : helpers.error('any.invalid'),
  )

/** The body every operation on an existing lobby shares: just the acting client session. */
const lobbyClientBody = Joi.object<LobbyClientRequest>({
  clientId: clientIdSchema,
})

/** The body of a request to have the server settle an outcome and announce it to a lobby's chat. */
const lobbyOutcomeBody = Joi.object<SendLobbyOutcomeRequest>({
  clientId: clientIdSchema,
  ...ROLLED_OUTCOME_REQUEST_KEYS,
})

/** The body every operation on a single slot shares. */
const lobbySlotBody = Joi.object<LobbySlotRequest>({
  clientId: clientIdSchema,
  slotId: Joi.string().required(),
})

/**
 * The body of a settings change. Every setting is optional (the host changes one at a time from the
 * lobby's settings dialog), but a request that names none of them has nothing to do, so at least one
 * is required. The service is what decides whether the combination is actually valid for the map.
 */
const updateLobbySettingsBody = Joi.object<UpdateLobbySettingsRequest>({
  clientId: clientIdSchema,
  name: Joi.string().custom((value, helpers) =>
    isValidLobbyName(value) ? value : helpers.error('any.invalid'),
  ),
  visibility: Joi.string().valid(...ALL_LOBBY_VISIBILITIES),
  map: Joi.string(),
  gameType: Joi.string().valid(...ALL_GAME_TYPES),
  gameSubType: Joi.number().min(1).max(7),
  allowObservers: Joi.boolean(),
  useLegacyLimits: Joi.boolean(),
  starcraftCompatibleReplays: Joi.boolean(),
  lockedAlliances: Joi.boolean(),
  mapQueue: Joi.array().items(Joi.string()).max(MAX_MAP_QUEUE),
})
  .or(
    'name',
    'visibility',
    'map',
    'gameType',
    'gameSubType',
    'allowObservers',
    'useLegacyLimits',
    'starcraftCompatibleReplays',
    'lockedAlliances',
    'mapQueue',
  )
  .required()

/** The body of a request to move a slot's occupant somewhere else. */
const moveSlotBody = Joi.object<MoveSlotRequest>({
  clientId: clientIdSchema,
  fromSlotId: Joi.string().required(),
  toSlotId: Joi.string().required(),
})

/**
 * Translates a failure from `LobbyService` into an HTTP error, passing anything that isn't a service
 * error through untouched.
 *
 * The join failures the client explains individually additionally carry a machine-readable
 * `LobbyJoinErrorCode` as the response body's `code`, in place of the service code every other
 * failure reports.
 *
 * Note that no failure here maps to 401: a 401 tells the client its session is gone and triggers a
 * logout, which is the wrong response to (say) naming a client id that has since disconnected.
 */
export function convertLobbyServiceError(err: unknown): void {
  if (!(err instanceof LobbyServiceError)) {
    throw err
  }

  switch (err.code) {
    case LobbyServiceErrorCode.ComputerInObserverSlot:
    case LobbyServiceErrorCode.InvalidGameSubType:
    case LobbyServiceErrorCode.InvalidGameType:
    case LobbyServiceErrorCode.InvalidMap:
    case LobbyServiceErrorCode.InvalidSlotId:
    case LobbyServiceErrorCode.InvalidSlotOperation:
    case LobbyServiceErrorCode.InvalidSlotType:
    case LobbyServiceErrorCode.NoActiveClient:
    case LobbyServiceErrorCode.NotEnoughSides:
    case LobbyServiceErrorCode.NotInLobby:
    case LobbyServiceErrorCode.NotObserverSlot:
    case LobbyServiceErrorCode.NotSeated:
    case LobbyServiceErrorCode.ReplayHashMismatch:
    case LobbyServiceErrorCode.UserOffline:
      throw asHttpError(400, err)

    case LobbyServiceErrorCode.NotHost:
    case LobbyServiceErrorCode.ChatRestricted:
    case LobbyServiceErrorCode.ForcedRace:
    case LobbyServiceErrorCode.NotOwnSlot:
    case LobbyServiceErrorCode.NotSlotController:
      throw asHttpError(403, err)

    case LobbyServiceErrorCode.ReplayNotFound:
      throw asHttpError(404, err)

    case LobbyServiceErrorCode.AlreadyInActivity:
    case LobbyServiceErrorCode.AlreadyInSlot:
    case LobbyServiceErrorCode.AlreadyStarted:
    case LobbyServiceErrorCode.CountingDown:
    case LobbyServiceErrorCode.GameInProgress:
    case LobbyServiceErrorCode.InvalidTeamLayout:
    case LobbyServiceErrorCode.NotCountingDown:
    case LobbyServiceErrorCode.NotEveryoneReady:
    case LobbyServiceErrorCode.ReplayLobby:
    case LobbyServiceErrorCode.ReplayNotLoading:
    case LobbyServiceErrorCode.ReplaySeeking:
    case LobbyServiceErrorCode.TargetNoActiveClient:
      throw asHttpError(409, err)

    case LobbyServiceErrorCode.NoLobby:
      throw new HttpErrorWithPayload(404, err.message, { code: LobbyJoinErrorCode.NoLongerOpen })
    case LobbyServiceErrorCode.Banned:
      throw new HttpErrorWithPayload(409, err.message, { code: LobbyJoinErrorCode.Banned })
    case LobbyServiceErrorCode.LobbyFull:
      throw new HttpErrorWithPayload(409, err.message, { code: LobbyJoinErrorCode.Full })
    case LobbyServiceErrorCode.ObserversFull:
      throw new HttpErrorWithPayload(409, err.message, {
        code: LobbyJoinErrorCode.ObserversFull,
      })
    case LobbyServiceErrorCode.JoinAlreadyInActivity:
      throw new HttpErrorWithPayload(409, err.message, {
        code: LobbyJoinErrorCode.AlreadyInActivity,
      })
    case LobbyServiceErrorCode.ReplayNotAccessible:
      throw new HttpErrorWithPayload(403, err.message, {
        code: LobbyJoinErrorCode.ReplayNotAccessible,
      })

    default:
      return assertUnreachable(err.code)
  }
}

const convertLobbyServiceErrors = makeErrorConverterMiddleware(convertLobbyServiceError)

/**
 * Every client-initiated lobby operation. The websocket side of lobbies (`lobby-socket-api`)
 * carries only server-to-client updates and the public list subscription.
 *
 * Lobby membership is per-client rather than per-user, so each request names the client session it
 * comes from; the lobby it applies to is then derived from that client, with the route's `:lobbyId`
 * asserted against it so a stale tab can't act on a lobby the user has since moved on from.
 */
@httpApi('/lobbies')
@httpBeforeAll(convertLobbyServiceErrors)
export class LobbyApi {
  constructor(
    private lobbyService: LobbyService,
    private clientSocketsManager: ClientSocketsManager,
  ) {
    container.resolve(ReplayLobbySourceRetentionJob)
  }

  @httpPost('/')
  @httpBefore(...authed)
  async createLobby(ctx: RouterContext): Promise<CreateLobbyResponse> {
    const { body } = validateRequest(ctx, {
      body: Joi.object<CreateLobbyRequest>({
        clientId: clientIdSchema,
        name: Joi.string()
          .custom((value, helpers) =>
            isValidLobbyName(value) ? value : helpers.error('any.invalid'),
          )
          .required(),
        map: Joi.string(),
        gameType: Joi.string()
          .valid(...ALL_GAME_TYPES)
          .when('map', { is: Joi.exist(), then: Joi.required() }),
        replayGameId: Joi.string(),
        replayUploadId: Joi.string().uuid(),
        gameSubType: Joi.number().min(1).max(7),
        allowObservers: Joi.boolean(),
        useLegacyLimits: Joi.boolean(),
        starcraftCompatibleReplays: Joi.boolean(),
        lockedAlliances: Joi.boolean(),
        visibility: Joi.string().valid(...ALL_LOBBY_VISIBILITIES),
        region: regionSchema,
        rttMs: rttMsSchema,
        regionManual: regionManualSchema,
        clientPubkey: clientPubkeySchema,
        leaveCurrentLobby: Joi.boolean(),
      }).xor('map', 'replayGameId', 'replayUploadId'),
    })

    const { user, client } = this.getSockets(ctx, body.clientId)

    let replay: ReplaySessionSource | undefined
    if (body.replayGameId !== undefined) {
      replay = { kind: 'game', gameId: body.replayGameId }
    } else if (body.replayUploadId !== undefined) {
      replay = { kind: 'upload', sourceId: body.replayUploadId }
    }

    return await this.lobbyService.createLobby({
      name: body.name,
      map: body.map,
      gameType: body.gameType,
      replay,
      gameSubType: body.gameSubType,
      allowObservers: body.allowObservers,
      useLegacyLimits: body.useLegacyLimits,
      starcraftCompatibleReplays: body.starcraftCompatibleReplays,
      lockedAlliances: body.lockedAlliances,
      visibility: body.visibility,
      region: body.region,
      rttMs: body.rttMs,
      regionManual: body.regionManual,
      clientPubkey: body.clientPubkey,
      leaveCurrentLobby: body.leaveCurrentLobby,
      user,
      client,
    })
  }

  @httpPost('/:lobbyId/join')
  @httpBefore(...authed)
  async joinLobby(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, {
      params: lobbyIdParams,
      body: Joi.object<JoinLobbyRequest>({
        clientId: clientIdSchema,
        region: regionSchema,
        rttMs: rttMsSchema,
        regionManual: regionManualSchema,
        clientPubkey: clientPubkeySchema,
        asObserver: Joi.boolean(),
        leaveCurrentLobby: Joi.boolean(),
      }),
    })

    const { user, client } = this.getSockets(ctx, body.clientId)

    await this.lobbyService.joinLobby({
      id: params.lobbyId,
      region: body.region,
      rttMs: body.rttMs,
      regionManual: body.regionManual,
      clientPubkey: body.clientPubkey,
      asObserver: body.asObserver,
      leaveCurrentLobby: body.leaveCurrentLobby,
      user,
      client,
    })
  }

  @httpPost('/:lobbyId/leave')
  @httpBefore(...authed)
  async leaveLobby(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, {
      params: lobbyIdParams,
      body: lobbyClientBody,
    })

    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)

    this.lobbyService.leaveLobby({ client, lobbyId: params.lobbyId })
  }

  @httpPost('/:lobbyId/chat')
  @httpBefore(ensureLoggedIn, throttleMiddleware(lobbyChatThrottle, throttleByUser))
  async sendChat(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, {
      params: lobbyIdParams,
      body: Joi.object<SendLobbyChatRequest>({
        clientId: clientIdSchema,
        text: Joi.string().min(1).required(),
        emote: Joi.boolean(),
      }),
    })

    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)

    await this.lobbyService.sendChat({
      client,
      lobbyId: params.lobbyId,
      text: body.text,
      emote: body.emote,
    })
  }

  @httpPost('/:lobbyId/outcomes')
  @httpBefore(ensureLoggedIn, throttleMiddleware(lobbyChatThrottle, throttleByUser))
  async sendOutcome(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, {
      params: lobbyIdParams,
      body: lobbyOutcomeBody,
    })

    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)

    await this.lobbyService.sendOutcome({ client, lobbyId: params.lobbyId, request: body })
  }

  @httpPost('/:lobbyId/settings')
  @httpBefore(...authedAction)
  async updateSettings(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, {
      params: lobbyIdParams,
      body: updateLobbySettingsBody,
    })
    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)

    await this.lobbyService.updateSettings({
      client,
      lobbyId: params.lobbyId,
      name: body.name,
      visibility: body.visibility,
      map: body.map,
      gameType: body.gameType,
      gameSubType: body.gameSubType,
      allowObservers: body.allowObservers,
      useLegacyLimits: body.useLegacyLimits,
      starcraftCompatibleReplays: body.starcraftCompatibleReplays,
      lockedAlliances: body.lockedAlliances,
      mapQueue: body.mapQueue,
    })
  }

  @httpPost('/:lobbyId/move-slot')
  @httpBefore(...authedAction)
  async moveSlot(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, { params: lobbyIdParams, body: moveSlotBody })
    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)

    this.lobbyService.moveSlot({
      client,
      lobbyId: params.lobbyId,
      fromSlotId: body.fromSlotId,
      toSlotId: body.toSlotId,
    })
  }

  @httpPost('/:lobbyId/add-computer')
  @httpBefore(...authedAction)
  async addComputer(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, { params: lobbyIdParams, body: lobbySlotBody })
    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)

    this.lobbyService.addComputer({ client, lobbyId: params.lobbyId, slotId: body.slotId })
  }

  @httpPost('/:lobbyId/change-slot')
  @httpBefore(...authedAction)
  async changeSlot(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, { params: lobbyIdParams, body: lobbySlotBody })
    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)

    this.lobbyService.changeSlot({ client, lobbyId: params.lobbyId, slotId: body.slotId })
  }

  @httpPost('/:lobbyId/set-race')
  @httpBefore(...authedAction)
  async setRace(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, {
      params: lobbyIdParams,
      body: Joi.object<SetLobbyRaceRequest>({
        clientId: clientIdSchema,
        slotId: Joi.string().required(),
        race: Joi.string()
          .valid(...ALL_RACE_CHARS)
          .required(),
      }),
    })
    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)

    this.lobbyService.setRace({
      client,
      lobbyId: params.lobbyId,
      slotId: body.slotId,
      race: body.race,
    })
  }

  @httpPost('/:lobbyId/open-slot')
  @httpBefore(...authedAction)
  async openSlot(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, { params: lobbyIdParams, body: lobbySlotBody })
    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)

    this.lobbyService.openSlot({ client, lobbyId: params.lobbyId, slotId: body.slotId })
  }

  @httpPost('/:lobbyId/close-slot')
  @httpBefore(...authedAction)
  async closeSlot(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, { params: lobbyIdParams, body: lobbySlotBody })
    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)

    this.lobbyService.closeSlot({ client, lobbyId: params.lobbyId, slotId: body.slotId })
  }

  @httpPost('/:lobbyId/kick-player')
  @httpBefore(...authedAction)
  async kickPlayer(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, { params: lobbyIdParams, body: lobbySlotBody })
    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)

    this.lobbyService.kickPlayer({ client, lobbyId: params.lobbyId, slotId: body.slotId })
  }

  @httpPost('/:lobbyId/ban-player')
  @httpBefore(...authedAction)
  async banPlayer(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, { params: lobbyIdParams, body: lobbySlotBody })
    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)

    this.lobbyService.banPlayer({ client, lobbyId: params.lobbyId, slotId: body.slotId })
  }

  @httpPost('/:lobbyId/make-observer')
  @httpBefore(...authedAction)
  async makeObserver(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, { params: lobbyIdParams, body: lobbySlotBody })
    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)

    this.lobbyService.makeObserver({ client, lobbyId: params.lobbyId, slotId: body.slotId })
  }

  @httpPost('/:lobbyId/remove-observer')
  @httpBefore(...authedAction)
  async removeObserver(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, { params: lobbyIdParams, body: lobbySlotBody })
    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)

    this.lobbyService.removeObserver({ client, lobbyId: params.lobbyId, slotId: body.slotId })
  }

  @httpPost('/:lobbyId/ready')
  @httpBefore(...authedAction)
  async setReady(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, {
      params: lobbyIdParams,
      body: Joi.object<SetLobbyReadyRequest>({
        clientId: clientIdSchema,
        isReady: Joi.boolean().required(),
      }),
    })
    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)

    this.lobbyService.setReady({ client, lobbyId: params.lobbyId, isReady: body.isReady })
  }

  @httpPost('/:lobbyId/swap-teams')
  @httpBefore(...authedAction)
  async swapTeams(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, {
      params: lobbyIdParams,
      body: lobbyClientBody,
    })
    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)

    this.lobbyService.swapTeams({ client, lobbyId: params.lobbyId })
  }

  @httpPost('/:lobbyId/shuffle')
  @httpBefore(...authedAction)
  async shuffleSlots(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, {
      params: lobbyIdParams,
      body: lobbyClientBody,
    })
    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)

    this.lobbyService.shuffleSlots({ client, lobbyId: params.lobbyId })
  }

  @httpPost('/:lobbyId/start-countdown')
  @httpBefore(...authedAction)
  async startCountdown(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, {
      params: lobbyIdParams,
      body: Joi.object<StartLobbyCountdownRequest>({
        clientId: clientIdSchema,
        force: Joi.boolean(),
      }),
    })
    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)

    this.lobbyService.startCountdown({ client, lobbyId: params.lobbyId, force: body.force })
  }

  @httpPost('/:lobbyId/cancel-countdown')
  @httpBefore(...authedAction)
  async cancelCountdown(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, {
      params: lobbyIdParams,
      body: lobbyClientBody,
    })
    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)

    this.lobbyService.cancelCountdown({ client, lobbyId: params.lobbyId })
  }

  @httpGet('/:lobbyId/replay-source')
  @httpBefore(...authedAction)
  async getReplaySource(ctx: RouterContext): Promise<GetReplaySessionSourceResponse> {
    const { params, query } = validateRequest(ctx, {
      params: lobbyIdParams,
      query: lobbyClientBody,
    })
    const client = this.getClientSockets(ctx.session!.user.id, query.clientId)

    return await this.lobbyService.getReplayDownload({ client, lobbyId: params.lobbyId })
  }

  @httpPost('/:lobbyId/replay-loaded')
  @httpBefore(...authedAction)
  async reportReplayLoaded(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, {
      params: lobbyIdParams,
      body: Joi.object<ReportLobbyReplayLoadedRequest>({
        clientId: clientIdSchema,
        hash: Joi.string().hex().length(64).required(),
      }),
    })
    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)

    this.lobbyService.reportReplayLoaded({ client, lobbyId: params.lobbyId, hash: body.hash })
  }

  @httpPost('/:lobbyId/replay-load-failed')
  @httpBefore(...authedAction)
  async reportReplayLoadFailed(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, {
      params: lobbyIdParams,
      body: lobbyClientBody,
    })
    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)

    this.lobbyService.reportReplayLoadFailed({ client, lobbyId: params.lobbyId })
  }

  @httpPost('/:lobbyId/replay-ended')
  @httpBefore(...authedAction)
  async reportReplayEnded(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, {
      params: lobbyIdParams,
      body: lobbyClientBody,
    })
    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)

    this.lobbyService.reportReplayEnded({ client, lobbyId: params.lobbyId })
  }

  @httpPost('/:lobbyId/replay-speed')
  @httpBefore(...authedAction)
  async reportReplaySpeed(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, {
      params: lobbyIdParams,
      body: Joi.object<ReportLobbyReplaySpeedRequest>({
        clientId: clientIdSchema,
        paused: Joi.boolean().required(),
        speed: Joi.number().integer().min(0).max(6).required(),
        multiplier: Joi.number().integer().min(1).max(32).required(),
      }),
    })
    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)
    this.lobbyService.reportReplaySpeed({ client, lobbyId: params.lobbyId, speed: body })
  }

  @httpPost('/:lobbyId/replay-seek')
  @httpBefore(...authedAction)
  async reportReplaySeek(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, {
      params: lobbyIdParams,
      body: Joi.object<ReportLobbyReplaySeekRequest>({
        clientId: clientIdSchema,
        frame: Joi.number().integer().min(0).max(0xffffffff).required(),
      }),
    })
    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)
    this.lobbyService.reportReplaySeek({ client, lobbyId: params.lobbyId, frame: body.frame })
  }

  @httpPost('/:lobbyId/replay-seek-reached')
  @httpBefore(...authedAction)
  async reportReplaySeekReached(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, {
      params: lobbyIdParams,
      body: Joi.object<ReportLobbyReplaySeekReachedRequest>({
        clientId: clientIdSchema,
        epoch: Joi.number().integer().min(1).required(),
        frame: Joi.number().integer().min(0).max(0xffffffff).required(),
      }),
    })
    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)
    this.lobbyService.reportReplaySeekReached({
      client,
      lobbyId: params.lobbyId,
      seek: { epoch: body.epoch, frame: body.frame },
    })
  }

  @httpPost('/:lobbyId/replay-frame')
  @httpBefore(...authedAction)
  async reportReplayFrame(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, {
      params: lobbyIdParams,
      body: Joi.object<ReportLobbyReplayFrameRequest>({
        clientId: clientIdSchema,
        frame: Joi.number().integer().min(0).max(0xffffffff).required(),
      }),
    })
    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)
    this.lobbyService.reportReplayFrame({ client, lobbyId: params.lobbyId, frame: body.frame })
  }

  @httpGet('/:lobbyId/state')
  @httpBefore(...authedAction)
  async getLobbyState(ctx: RouterContext): Promise<GetLobbyStateResponse> {
    const { params } = validateRequest(ctx, { params: lobbyIdParams })

    return this.lobbyService.getLobbyState({ lobbyId: params.lobbyId })
  }

  /** Resolves the session's user and the named client session, or throws if either is unreachable. */
  private getSockets(
    ctx: RouterContext,
    clientId: string,
  ): { user: UserSocketsGroup; client: ClientSocketsGroup } {
    const userId = ctx.session!.user.id
    return {
      user: this.lobbyService.getUserById(userId),
      client: this.getClientSockets(userId, clientId),
    }
  }

  private getClientSockets(userId: SbUserId, clientId: string): ClientSocketsGroup {
    const client = this.clientSocketsManager.getById(userId, clientId)
    if (!client) {
      throw new LobbyServiceError(
        LobbyServiceErrorCode.NoActiveClient,
        'no socket connection for that client',
      )
    }
    return client
  }
}
