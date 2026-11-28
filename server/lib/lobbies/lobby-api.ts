import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import { ExtendableContext, Next } from 'koa'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { isValidLobbyName } from '../../../common/constants'
import { ALL_GAME_TYPES } from '../../../common/games/game-type'
import {
  ALL_LOBBY_VISIBILITIES,
  findBenchedUser,
  findSlotByUserId,
  MAX_MAP_QUEUE,
} from '../../../common/lobbies'
import {
  BEST_OF_LOGO_MAX_SIZE_BYTES,
  BEST_OF_MAX_LENGTH,
  BEST_OF_MAX_SIDE_SIZE,
  BEST_OF_OVERLAY_LINE_MAX_LENGTH,
  BEST_OF_TITLE_MAX_LENGTH,
} from '../../../common/lobbies/lobby-best-of'
import {
  ALL_LOBBY_MAP_STATUSES,
  CreateLobbyRequest,
  CreateLobbyResponse,
  DiscardLobbyBestOfGameRequest,
  EndLobbyBestOfRequest,
  GetLobbyMapUrlRequest,
  GetLobbyMapUrlResponse,
  GetLobbyStateResponse,
  InviteToLobbyErrorCode,
  InviteToLobbyRequest,
  JoinLobbyRequest,
  LobbyClientRequest,
  LobbyJoinErrorCode,
  LobbyServiceErrorCode,
  LobbySlotRequest,
  MoveSlotRequest,
  SendLobbyChatRequest,
  SendLobbyOutcomeRequest,
  SetLobbyMapStatusRequest,
  SetLobbyRaceRequest,
  SetLobbyReadyRequest,
  StartLobbyBestOfRequest,
  StartLobbyCountdownRequest,
  UpdateLobbyBestOfRequest,
  UpdateLobbySettingsRequest,
} from '../../../common/lobbies/lobby-network'
import { SbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import { NotificationType } from '../../../common/notifications'
import { isPrettyId } from '../../../common/pretty-id'
import { ALL_RACE_CHARS } from '../../../common/races'
import { SbUserId } from '../../../common/users/sb-user-id'
import { makeErrorConverterMiddleware } from '../errors/coded-error'
import { asHttpError, HttpErrorWithPayload } from '../errors/error-with-payload'
import { handleMultipartFiles } from '../files/handle-multipart-files'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpBefore, httpGet, httpPost } from '../http/route-decorators'
import logger from '../logging/logger'
import { ROLLED_OUTCOME_REQUEST_KEYS } from '../messaging/rolled-outcome-request-schema'
import NotificationService from '../notifications/notification-service'
import ensureLoggedIn from '../session/ensure-logged-in'
import { AccountSettingsService } from '../settings/account-settings-service'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware, { throttleByUser, throttleMiddlewareFunc } from '../throttle/middleware'
import { findUserById } from '../users/user-model'
import { UserRelationshipService } from '../users/user-relationship-service'
import { validateRequest } from '../validation/joi-validator'
import { json } from '../validation/json-validator'
import {
  ClientSocketsGroup,
  ClientSocketsManager,
  UserSocketsGroup,
} from '../websockets/socket-groups'
import {
  BestOfLogoChange,
  LobbyBestOfOverlayService,
  UploadedBestOfLogo,
} from './lobby-best-of-overlay-service'
import { LobbyService, LobbyServiceError } from './lobby-service'

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

// Invites land in another user's notification list, so they get a tighter cap than the ordinary
// in-lobby actions: a sender can't flood someone's notifications faster than this.
const lobbyInviteThrottle = createThrottle('lobbies/invite', {
  rate: 5,
  burst: 10,
  window: 60000,
})

// Koa mounts every API sharing a base path onto the same prefix, and a router's `use` middleware
// runs for every request under that prefix -- including ones only a *sibling* class has a route
// for. `/lobbies` is also served by the deliberately unauthenticated `LobbySummaryApi`, so the login
// check has to be attached per route here rather than to the class, or it would guard that endpoint
// too.
// Starting or saving a best-of series with a logo attached costs an image safety check and a stored
// file, so those requests get an image upload's tighter cap.
const bestOfLogoThrottle = createThrottle('lobbies/best-of-logo', {
  rate: 3,
  burst: 12,
  window: 60000,
})

const authed = [ensureLoggedIn, throttleMiddleware(lobbyThrottle, throttleByUser)]
const authedAction = [ensureLoggedIn, throttleMiddleware(lobbyActionThrottle, throttleByUser)]

/** Throttles a best-of start or save by whether it has a logo file attached. */
async function throttleBestOfChange(ctx: ExtendableContext, next: Next) {
  const throttle = ctx.request.files?.logo ? bestOfLogoThrottle : lobbyActionThrottle
  await throttleMiddlewareFunc(throttle, throttleByUser, ctx, next)
}

/**
 * The middleware of a best-of start or save: the login check before the upload is read, the
 * upload with the logo's own size limit, and then the throttle that depends on it.
 */
const bestOfChange = [
  ensureLoggedIn,
  handleMultipartFiles(BEST_OF_LOGO_MAX_SIZE_BYTES),
  throttleBestOfChange,
]

/**
 * Returns how a best-of start or save treats the logo: the `logo` file field, when one was
 * uploaded, replaces it, and `deleteLogo` removes it.
 */
function getBestOfLogoChange(
  ctx: RouterContext,
  deleteLogo: boolean | undefined,
): BestOfLogoChange {
  const file = ctx.request.files?.logo
  if (Array.isArray(file)) {
    throw new httpErrors.BadRequest('only one logo file can be uploaded')
  }
  if (file && deleteLogo) {
    throw new httpErrors.BadRequest("a logo can't be uploaded and removed at once")
  }
  if (file) {
    return { kind: 'replace', file: file as UploadedBestOfLogo }
  }
  return deleteLogo ? { kind: 'remove' } : { kind: 'keep' }
}

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
 * A best-of series title, trimmed. Empty is accepted and means no title; the service has the final
 * say on what a title can be.
 */
const bestOfTitleSchema = Joi.string().allow('').trim().max(BEST_OF_TITLE_MAX_LENGTH)

/** One side of a best-of series: the user ids of the people playing for it. */
const bestOfSideSchema = Joi.array()
  .items(Joi.number().integer().min(1))
  .min(1)
  .max(BEST_OF_MAX_SIDE_SIZE)
  .required()

/**
 * A best-of series' two sides, in order. Who may be on them (members of the lobby, nobody on both)
 * is the service's to check.
 */
const bestOfSidesSchema = Joi.array().ordered(bestOfSideSchema, bestOfSideSchema).length(2)

/**
 * A text line of a best-of series' caster overlay, trimmed. Empty is accepted and means no line; the
 * service has the final say on what a line can be.
 */
const bestOfOverlayLineSchema = Joi.string().allow('').trim().max(BEST_OF_OVERLAY_LINE_MAX_LENGTH)

/** The multipart body of a best-of start: the request as JSON in its `series` field. */
const startBestOfBody = Joi.object<{ series: StartLobbyBestOfRequest }>({
  series: json
    .object({
      clientId: clientIdSchema,
      length: Joi.number().integer().min(1).max(BEST_OF_MAX_LENGTH).required(),
      title: bestOfTitleSchema,
      sides: bestOfSidesSchema.required(),
      line1: bestOfOverlayLineSchema,
      line2: bestOfOverlayLineSchema,
      deleteLogo: Joi.boolean(),
    })
    .required(),
})

/**
 * The multipart body of a change to the running best-of series: the request as JSON in its
 * `changes` field. Whether it changes anything also depends on whether a logo file came with it.
 */
const updateBestOfBody = Joi.object<{ changes: UpdateLobbyBestOfRequest }>({
  changes: json
    .object({
      clientId: clientIdSchema,
      title: bestOfTitleSchema.allow(null),
      sides: bestOfSidesSchema,
      line1: bestOfOverlayLineSchema.allow(null),
      line2: bestOfOverlayLineSchema.allow(null),
      deleteLogo: Joi.boolean(),
    })
    .required(),
})

const discardBestOfGameBody = Joi.object<DiscardLobbyBestOfGameRequest>({
  clientId: clientIdSchema,
  gameId: Joi.string().required(),
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
    case LobbyServiceErrorCode.BestOfLogoInappropriate:
    case LobbyServiceErrorCode.BestOfLogoInvalidFormat:
    case LobbyServiceErrorCode.BestOfLogoTooLarge:
    case LobbyServiceErrorCode.BestOfLogoUnsupportedSvg:
    case LobbyServiceErrorCode.ComputerInObserverSlot:
    case LobbyServiceErrorCode.InvalidBestOf:
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
    case LobbyServiceErrorCode.BestOfAlreadyRunning:
    case LobbyServiceErrorCode.BestOfGameNotPending:
    case LobbyServiceErrorCode.BestOfGamePending:
    case LobbyServiceErrorCode.BestOfRosterMismatch:
    case LobbyServiceErrorCode.CountingDown:
    case LobbyServiceErrorCode.GameInProgress:
    case LobbyServiceErrorCode.InvalidTeamLayout:
    case LobbyServiceErrorCode.MapNotDownloaded:
    case LobbyServiceErrorCode.NoBestOfRunning:
    case LobbyServiceErrorCode.NotCountingDown:
    case LobbyServiceErrorCode.NotEveryoneReady:
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
    private notificationService: NotificationService,
    private userRelationshipService: UserRelationshipService,
    private accountSettingsService: AccountSettingsService,
    private bestOfOverlayService: LobbyBestOfOverlayService,
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
        race: Joi.string().valid(...ALL_RACE_CHARS),
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
      }),
    })

    const { user, client } = this.getSockets(ctx, body.clientId)

    return await this.lobbyService.createLobby({
      name: body.name,
      map: body.map,
      gameType: body.gameType,
      gameSubType: body.gameSubType,
      race: body.race,
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
        race: Joi.string().valid(...ALL_RACE_CHARS),
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
      race: body.race,
      region: body.region,
      rttMs: body.rttMs,
      regionManual: body.regionManual,
      clientPubkey: body.clientPubkey,
      asObserver: body.asObserver,
      leaveCurrentLobby: body.leaveCurrentLobby,
      user,
      client,
    })

    // The invite has been acted on, so it shouldn't linger in the invitee's notification list.
    // This isn't awaited: the join has already happened, so a failed cleanup must not fail the
    // request.
    this.notificationService
      .clearFirstMatching({
        userId: ctx.session!.user.id,
        data: { type: NotificationType.LobbyInvite, lobbyId: params.lobbyId },
      })
      .catch(err => logger.error({ err }, 'error clearing the invite for a joined lobby'))
  }

  /**
   * Invites a user to the lobby the acting client is in. Membership is what grants the invitation,
   * so any member can send one; the invite arrives as a notification the recipient can act on.
   */
  @httpPost('/:lobbyId/invite')
  @httpBefore(ensureLoggedIn, throttleMiddleware(lobbyInviteThrottle, throttleByUser))
  async inviteToLobby(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, {
      params: lobbyIdParams,
      body: Joi.object<InviteToLobbyRequest>({
        clientId: clientIdSchema,
        targetId: Joi.number().min(1).required(),
      }),
    })

    const userId = ctx.session!.user.id
    const client = this.getClientSockets(userId, body.clientId)

    // Asserts the actor is actually in this lobby before letting them invite to it.
    const lobby = this.lobbyService.getLobbyForClient(client, params.lobbyId)

    if (body.targetId === userId) {
      throw httpErrors.BadRequest("Can't invite yourself to a lobby")
    }

    const target = await findUserById(body.targetId as SbUserId)
    if (!target) {
      throw httpErrors.NotFound('Target user not found')
    }

    // The target's own settings decide who else may invite them.
    const targetSettings = await this.accountSettingsService.getSettings(target.id)
    const invitesAllowed =
      targetSettings.allowInvitesFrom === 'all' ||
      (targetSettings.allowInvitesFrom === 'friends' &&
        (await this.userRelationshipService.areFriends(userId, target.id)))
    if (!invitesAllowed) {
      throw new HttpErrorWithPayload(409, 'User is not accepting lobby invites', {
        code: InviteToLobbyErrorCode.NotAcceptingInvites,
      })
    }

    if (this.lobbyService.lobbyBannedUsers.get(lobby.id)?.has(target.id)) {
      throw new HttpErrorWithPayload(409, 'User has been banned from lobby', {
        code: InviteToLobbyErrorCode.BannedFromLobby,
      })
    }

    // Someone already in the lobby has nothing to accept.
    if (findSlotByUserId(lobby, target.id).length || findBenchedUser(lobby, target.id)) {
      throw new HttpErrorWithPayload(409, 'User is already in this lobby', {
        code: InviteToLobbyErrorCode.AlreadyInLobby,
      })
    }

    // Every check above fails the request, and none of them depends on a block, so the response
    // never reveals whether one exists. The two checks below end the request silently instead, so
    // a repeat invite and a blocked invite both look exactly like a delivered one to the inviter.

    // The invitee only needs one outstanding invite per lobby; another would just stack an
    // identical entry in their notification list.
    const existingInvites = await this.notificationService.retrieveNotifications({
      userId: target.id,
      data: { type: NotificationType.LobbyInvite, lobbyId: lobby.id },
      limit: 1,
    })
    if (existingInvites.length) {
      return
    }

    // A block in either direction stops the invite from being delivered.
    const [inviterBlockedByTarget, targetBlockedByInviter] = await Promise.all([
      this.userRelationshipService.isUserBlockedBy(userId, target.id),
      this.userRelationshipService.isUserBlockedBy(target.id, userId),
    ])
    if (inviterBlockedByTarget || targetBlockedByInviter) {
      return
    }

    await this.notificationService.addNotification({
      userId: target.id,
      data: {
        type: NotificationType.LobbyInvite,
        from: userId,
        lobbyId: lobby.id,
      },
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

  @httpPost('/:lobbyId/transfer-host')
  @httpBefore(...authedAction)
  async transferHost(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, { params: lobbyIdParams, body: lobbySlotBody })
    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)

    this.lobbyService.transferHost({ client, lobbyId: params.lobbyId, slotId: body.slotId })
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

  @httpPost('/:lobbyId/map-status')
  @httpBefore(...authedAction)
  async setMapStatus(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, {
      params: lobbyIdParams,
      body: Joi.object<SetLobbyMapStatusRequest>({
        clientId: clientIdSchema,
        mapId: Joi.string().required(),
        status: Joi.string()
          .valid(...ALL_LOBBY_MAP_STATUSES)
          .required(),
      }),
    })
    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)

    this.lobbyService.setMapStatus({
      client,
      lobbyId: params.lobbyId,
      mapId: body.mapId,
      status: body.status,
    })
  }

  @httpPost('/:lobbyId/map-url')
  @httpBefore(...authedAction)
  async getMapUrl(ctx: RouterContext): Promise<GetLobbyMapUrlResponse> {
    const { params, body } = validateRequest(ctx, {
      params: lobbyIdParams,
      body: Joi.object<GetLobbyMapUrlRequest>({
        clientId: clientIdSchema,
        mapId: Joi.string().required(),
      }),
    })
    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)

    const mapUrl = await this.lobbyService.getMapUrl({
      client,
      lobbyId: params.lobbyId,
      mapId: body.mapId,
    })
    if (!mapUrl) {
      throw new httpErrors.Conflict("that map isn't the lobby's current map")
    }
    return { mapUrl }
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

  @httpPost('/:lobbyId/start-best-of')
  @httpBefore(...bestOfChange)
  async startBestOf(ctx: RouterContext): Promise<void> {
    const {
      params,
      body: { series },
    } = validateRequest(ctx, {
      params: lobbyIdParams,
      body: startBestOfBody,
    })
    const logoChange = getBestOfLogoChange(ctx, series.deleteLogo)
    const client = this.getClientSockets(ctx.session!.user.id, series.clientId)

    await this.bestOfOverlayService.startBestOf(
      {
        client,
        lobbyId: params.lobbyId,
        length: series.length,
        title: series.title,
        sides: series.sides,
        line1: series.line1,
        line2: series.line2,
      },
      logoChange,
    )
  }

  @httpPost('/:lobbyId/update-best-of')
  @httpBefore(...bestOfChange)
  async updateBestOf(ctx: RouterContext): Promise<void> {
    const {
      params,
      body: { changes },
    } = validateRequest(ctx, {
      params: lobbyIdParams,
      body: updateBestOfBody,
    })
    const logoChange = getBestOfLogoChange(ctx, changes.deleteLogo)
    if (
      changes.title === undefined &&
      changes.sides === undefined &&
      changes.line1 === undefined &&
      changes.line2 === undefined &&
      logoChange.kind === 'keep'
    ) {
      throw new httpErrors.BadRequest('nothing to change')
    }
    const client = this.getClientSockets(ctx.session!.user.id, changes.clientId)

    await this.bestOfOverlayService.updateBestOf(
      {
        client,
        lobbyId: params.lobbyId,
        title: changes.title,
        sides: changes.sides,
        line1: changes.line1,
        line2: changes.line2,
      },
      logoChange,
    )
  }

  @httpPost('/:lobbyId/end-best-of')
  @httpBefore(...authedAction)
  async endBestOf(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, {
      params: lobbyIdParams,
      body: Joi.object<EndLobbyBestOfRequest>({ clientId: clientIdSchema }),
    })
    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)

    this.lobbyService.endBestOf({ client, lobbyId: params.lobbyId })
  }

  @httpPost('/:lobbyId/discard-best-of-game')
  @httpBefore(...authedAction)
  async discardBestOfGame(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, {
      params: lobbyIdParams,
      body: discardBestOfGameBody,
    })
    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)

    this.lobbyService.discardBestOfGame({
      client,
      lobbyId: params.lobbyId,
      gameId: body.gameId,
    })
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
    if (client.clientType !== 'electron') {
      throw new LobbyServiceError(LobbyServiceErrorCode.NoActiveClient, 'not an app client')
    }
    return client
  }
}
