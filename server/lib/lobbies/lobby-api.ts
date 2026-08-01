import { RouterContext } from '@koa/router'
import Joi from 'joi'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { isValidLobbyName } from '../../../common/constants'
import { ALL_GAME_TYPES } from '../../../common/games/game-type'
import { ALL_LOBBY_VISIBILITIES } from '../../../common/lobbies'
import {
  CreateLobbyRequest,
  CreateLobbyResponse,
  GetLobbyStateResponse,
  JoinLobbyRequest,
  LobbyClientRequest,
  LobbyJoinErrorCode,
  LobbySlotRequest,
  MoveSlotRequest,
  SendLobbyChatRequest,
  SetLobbyRaceRequest,
  UpdateLobbySettingsRequest,
} from '../../../common/lobbies/lobby-network'
import { SbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import { isPrettyId } from '../../../common/pretty-id'
import { ALL_RACE_CHARS } from '../../../common/races'
import { SbUserId } from '../../../common/users/sb-user-id'
import { makeErrorConverterMiddleware } from '../errors/coded-error'
import { asHttpError, HttpErrorWithPayload } from '../errors/error-with-payload'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpBefore, httpGet, httpPost } from '../http/route-decorators'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware, { throttleByUser } from '../throttle/middleware'
import { validateRequest } from '../validation/joi-validator'
import {
  ClientSocketsGroup,
  ClientSocketsManager,
  UserSocketsGroup,
} from '../websockets/socket-groups'
import { LobbyService, LobbyServiceError, LobbyServiceErrorCode } from './lobby-service'

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
  map: Joi.string(),
  gameType: Joi.string().valid(...ALL_GAME_TYPES),
  gameSubType: Joi.number().min(1).max(7),
  allowObservers: Joi.boolean(),
  useLegacyLimits: Joi.boolean(),
})
  .or('map', 'gameType', 'gameSubType', 'allowObservers', 'useLegacyLimits')
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
    case LobbyServiceErrorCode.UserOffline:
      throw asHttpError(400, err)

    case LobbyServiceErrorCode.NotHost:
    case LobbyServiceErrorCode.ChatRestricted:
    case LobbyServiceErrorCode.ForcedRace:
    case LobbyServiceErrorCode.NotOwnSlot:
    case LobbyServiceErrorCode.NotSlotController:
      throw asHttpError(403, err)

    case LobbyServiceErrorCode.AlreadyInActivity:
    case LobbyServiceErrorCode.AlreadyInSlot:
    case LobbyServiceErrorCode.AlreadyStarted:
    case LobbyServiceErrorCode.CountingDown:
    case LobbyServiceErrorCode.GameInProgress:
    case LobbyServiceErrorCode.TargetNoActiveClient:
      throw asHttpError(409, err)

    case LobbyServiceErrorCode.NoLobby:
      throw new HttpErrorWithPayload(404, err.message, { code: LobbyJoinErrorCode.NoLongerOpen })
    case LobbyServiceErrorCode.JoinAlreadyStarted:
      throw new HttpErrorWithPayload(409, err.message, { code: LobbyJoinErrorCode.AlreadyStarted })
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
  ) {}

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
        map: Joi.string().required(),
        gameType: Joi.string()
          .valid(...ALL_GAME_TYPES)
          .required(),
        gameSubType: Joi.number().min(1).max(7),
        allowObservers: Joi.boolean(),
        useLegacyLimits: Joi.boolean(),
        visibility: Joi.string().valid(...ALL_LOBBY_VISIBILITIES),
        region: regionSchema,
        rttMs: rttMsSchema,
        clientPubkey: clientPubkeySchema,
        leaveCurrentLobby: Joi.boolean(),
      }),
    })

    const { user, client } = this.getSockets(ctx, body.clientId)

    return await this.lobbyService.createLobby({
      name: body.name,
      map: body.map,
      gameType: body.gameType,
      gameSubType: body.gameSubType,
      allowObservers: body.allowObservers,
      useLegacyLimits: body.useLegacyLimits,
      visibility: body.visibility,
      region: body.region,
      rttMs: body.rttMs,
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
      }),
    })

    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)

    await this.lobbyService.sendChat({ client, lobbyId: params.lobbyId, text: body.text })
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
      map: body.map,
      gameType: body.gameType,
      gameSubType: body.gameSubType,
      allowObservers: body.allowObservers,
      useLegacyLimits: body.useLegacyLimits,
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

  @httpPost('/:lobbyId/start-countdown')
  @httpBefore(...authedAction)
  async startCountdown(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, {
      params: lobbyIdParams,
      body: lobbyClientBody,
    })
    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)

    this.lobbyService.startCountdown({ client, lobbyId: params.lobbyId })
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
