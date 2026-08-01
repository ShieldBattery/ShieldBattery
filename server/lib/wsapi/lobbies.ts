import errors from 'http-errors'
import { Map as IMap } from 'immutable'
import { NextFunc, NydusClient, NydusServer } from 'nydus'
import { container } from 'tsyringe'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { isValidLobbyName, validRace } from '../../../common/constants'
import { GameServerRegionId } from '../../../common/game-server-regions'
import { GameType, isValidGameSubType, isValidGameType } from '../../../common/games/game-type'
import { ALL_LOBBY_VISIBILITIES, LobbyVisibility } from '../../../common/lobbies'
import { LobbyCreateErrorCode, LobbyJoinErrorCode } from '../../../common/lobbies/lobby-network'
import { SbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import { SbMapId } from '../../../common/maps'
import { isPrettyId } from '../../../common/pretty-id'
import {
  LOBBY_LIST_PATH,
  LobbyService,
  LobbyServiceError,
  LobbyServiceErrorCode,
} from '../lobbies/lobby-service'
import { Api, Mount, registerApiRoutes } from '../websockets/api-decorators'
import {
  ClientSocketsGroup,
  ClientSocketsManager,
  UserSocketsGroup,
  UserSocketsManager,
} from '../websockets/socket-groups'
import validateBody from '../websockets/validate-body'

const nonEmptyString = (str: unknown) => typeof str === 'string' && str.length > 0
const isLobbyId = (id: unknown) => typeof id === 'string' && isPrettyId(id)

// The desired region is an opaque id, loosely validated here; the handler checks it against the
// live region list and drops it if unknown, so a client with no measured regions joins region-less.
const isValidRegion = (region: unknown) =>
  region === undefined || (typeof region === 'string' && region.length > 0 && region.length <= 64)
// `rttMs` is only meaningful alongside a region; the region list check is what actually gates it.
const isValidRttMs = (rttMs: unknown) =>
  rttMs === undefined || (typeof rttMs === 'number' && rttMs >= 0)
// The per-session netcode v2 public key is optional here (a solo-vs-AI lobby never uses netcode v2),
// but when present it must decode to exactly 32 raw bytes (an Ed25519 public key).
const isValidNetcodeV2Pubkey = (pubkey: unknown) =>
  pubkey === undefined ||
  (typeof pubkey === 'string' && Buffer.from(pubkey, 'base64').length === 32)
const isValidVisibility = (visibility: unknown) =>
  visibility === undefined || ALL_LOBBY_VISIBILITIES.includes(visibility as LobbyVisibility)

interface ListSubscription {
  onUnsubscribe?: () => void
  count: number
}

/**
 * Translates a failure from `LobbyService` into the error this API returns to the client, passing
 * anything that isn't a service error through untouched.
 *
 * The create and join failures the client explains individually additionally carry a machine-
 * readable `LobbyCreateErrorCode`/`LobbyJoinErrorCode` in the error body.
 */
function convertLobbyServiceError(err: unknown): never {
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
      throw new errors.BadRequest(err.message)

    case LobbyServiceErrorCode.NotHost:
      throw new errors.Unauthorized(err.message)

    case LobbyServiceErrorCode.ChatRestricted:
    case LobbyServiceErrorCode.ForcedRace:
    case LobbyServiceErrorCode.NotOwnSlot:
    case LobbyServiceErrorCode.NotSlotController:
      throw new errors.Forbidden(err.message)

    case LobbyServiceErrorCode.AlreadyInActivity:
    case LobbyServiceErrorCode.AlreadyInSlot:
    case LobbyServiceErrorCode.AlreadyStarted:
    case LobbyServiceErrorCode.CountingDown:
    case LobbyServiceErrorCode.TargetNoActiveClient:
      throw new errors.Conflict(err.message)

    case LobbyServiceErrorCode.NameTaken:
      throw Object.assign(new errors.Conflict(err.message), {
        body: { code: LobbyCreateErrorCode.NameTaken },
      })

    case LobbyServiceErrorCode.NoLobby:
      throw Object.assign(new errors.NotFound(err.message), {
        body: { code: LobbyJoinErrorCode.NoLongerOpen },
      })
    case LobbyServiceErrorCode.JoinAlreadyStarted:
      throw Object.assign(new errors.Conflict(err.message), {
        body: { code: LobbyJoinErrorCode.AlreadyStarted },
      })
    case LobbyServiceErrorCode.Banned:
      throw Object.assign(new errors.Conflict(err.message), {
        body: { code: LobbyJoinErrorCode.Banned },
      })
    case LobbyServiceErrorCode.LobbyFull:
      throw Object.assign(new errors.Conflict(err.message), {
        body: { code: LobbyJoinErrorCode.Full },
      })
    case LobbyServiceErrorCode.JoinAlreadyInActivity:
      throw Object.assign(new errors.Conflict(err.message), {
        body: { code: LobbyJoinErrorCode.AlreadyInActivity },
      })

    default:
      return assertUnreachable(err.code)
  }
}

@Mount(LOBBY_LIST_PATH)
export class LobbyApi {
  readonly lobbyService = container.resolve(LobbyService)

  readonly subscribedSockets = new Map<string, ListSubscription>()

  constructor(
    readonly nydus: NydusServer,
    readonly userSockets: UserSocketsManager,
    readonly clientSockets: ClientSocketsManager,
  ) {
    this.clientSockets.on('newClient', client => {
      client.subscribe('/lobbiesCount', () => ({ count: this.lobbyService.getLobbiesCount() }))
    })
  }

  @Api('/subscribe')
  async subscribe(data: IMap<string, any>, next: NextFunc) {
    const socket = data.get('client')
    const existingSubscription = this.subscribedSockets.get(socket.id)
    if (existingSubscription) {
      existingSubscription.count++
      return
    }

    const summary = this.lobbyService.getListedSummaries()
    this.nydus.subscribeClient(socket, LOBBY_LIST_PATH, { action: 'full', payload: summary })

    const onClose = () => {
      this.nydus.unsubscribeClient(socket, LOBBY_LIST_PATH)
      this.subscribedSockets.delete(socket.id)
    }
    socket.once('close', onClose)
    this.subscribedSockets.set(socket.id, {
      onUnsubscribe: () => socket.removeListener('close', onClose),
      count: 1,
    })
  }

  @Api('/unsubscribe')
  async unsubscribe(data: IMap<string, any>, next: NextFunc) {
    const socket = data.get('client') as NydusClient
    const subscription = this.subscribedSockets.get(socket.id)
    if (!subscription) {
      throw new errors.Conflict('not subscribed')
    }

    if (subscription.count === 1) {
      this.nydus.unsubscribeClient(socket, LOBBY_LIST_PATH)
      this.subscribedSockets.delete(socket.id)
      subscription.onUnsubscribe?.()
    } else {
      subscription.count--
    }
  }

  @Api(
    '/create',
    validateBody({
      name: isValidLobbyName,
      map: nonEmptyString,
      gameType: isValidGameType,
      gameSubType: isValidGameSubType,
      allowObservers: (b: unknown) => b === undefined || b === true || b === false,
      useLegacyLimits: (b: unknown) => b === undefined || b === true || b === false,
      visibility: isValidVisibility,
      region: isValidRegion,
      rttMs: isValidRttMs,
      clientPubkey: isValidNetcodeV2Pubkey,
    }),
  )
  async create(data: IMap<string, any>, next: NextFunc) {
    const {
      name,
      map,
      gameType,
      gameSubType,
      allowObservers,
      useLegacyLimits,
      visibility,
      region,
      rttMs,
      clientPubkey,
    } = data.get('body') as {
      name: string
      map: SbMapId
      gameType: GameType
      gameSubType?: number
      allowObservers?: boolean
      useLegacyLimits?: boolean
      visibility?: LobbyVisibility
      region?: GameServerRegionId
      rttMs?: number
      clientPubkey?: string
    }
    const user = this.getUser(data)
    const client = this.getClient(data)

    try {
      return await this.lobbyService.createLobby({
        name,
        map,
        gameType,
        gameSubType,
        allowObservers,
        useLegacyLimits,
        visibility,
        region,
        rttMs,
        clientPubkey,
        user,
        client,
      })
    } catch (err) {
      return convertLobbyServiceError(err)
    }
  }

  @Api(
    '/join',
    validateBody({
      id: isLobbyId,
      region: isValidRegion,
      rttMs: isValidRttMs,
      clientPubkey: isValidNetcodeV2Pubkey,
    }),
  )
  async join(data: IMap<string, any>, next: NextFunc) {
    const { id, region, rttMs, clientPubkey } = data.get('body') as {
      id: SbLobbyId
      region?: GameServerRegionId
      rttMs?: number
      clientPubkey?: string
    }
    const user = this.getUser(data)
    const client = this.getClient(data)

    try {
      await this.lobbyService.joinLobby({ id, region, rttMs, clientPubkey, user, client })
    } catch (err) {
      convertLobbyServiceError(err)
    }
  }

  @Api(
    '/sendChat',
    validateBody({
      text: nonEmptyString,
    }),
  )
  async sendChat(data: IMap<string, any>, next: NextFunc) {
    const client = this.getClient(data)
    const { text } = data.get('body')

    try {
      await this.lobbyService.sendChat({ client, text })
    } catch (err) {
      convertLobbyServiceError(err)
    }
  }

  @Api(
    '/addComputer',
    validateBody({
      slotId: nonEmptyString,
    }),
  )
  async addComputer(data: IMap<string, any>, next: NextFunc) {
    const client = this.getClient(data)
    const { slotId } = data.get('body')

    try {
      this.lobbyService.addComputer({ client, slotId })
    } catch (err) {
      convertLobbyServiceError(err)
    }
  }

  @Api(
    '/changeSlot',
    validateBody({
      slotId: nonEmptyString,
    }),
  )
  async changeSlot(data: IMap<string, any>, next: NextFunc) {
    const client = this.getClient(data)
    const { slotId } = data.get('body')

    try {
      this.lobbyService.changeSlot({ client, slotId })
    } catch (err) {
      convertLobbyServiceError(err)
    }
  }

  @Api(
    '/setRace',
    validateBody({
      id: nonEmptyString,
      race: validRace,
    }),
  )
  async setRace(data: IMap<string, any>, next: NextFunc) {
    const client = this.getClient(data)
    const { id, race } = data.get('body')

    try {
      this.lobbyService.setRace({ client, slotId: id, race })
    } catch (err) {
      convertLobbyServiceError(err)
    }
  }

  @Api(
    '/openSlot',
    validateBody({
      slotId: nonEmptyString,
    }),
  )
  async openSlot(data: IMap<string, any>, next: NextFunc) {
    const client = this.getClient(data)
    const { slotId } = data.get('body')

    try {
      this.lobbyService.openSlot({ client, slotId })
    } catch (err) {
      convertLobbyServiceError(err)
    }
  }

  @Api(
    '/closeSlot',
    validateBody({
      slotId: nonEmptyString,
    }),
  )
  async closeSlot(data: IMap<string, any>, next: NextFunc) {
    const client = this.getClient(data)
    const { slotId } = data.get('body')

    try {
      this.lobbyService.closeSlot({ client, slotId })
    } catch (err) {
      convertLobbyServiceError(err)
    }
  }

  @Api('/kickPlayer')
  async kickPlayer(data: IMap<string, any>, next: NextFunc) {
    const client = this.getClient(data)
    const { slotId } = data.get('body')

    try {
      this.lobbyService.kickPlayer({ client, slotId })
    } catch (err) {
      convertLobbyServiceError(err)
    }
  }

  @Api('/banPlayer')
  async banPlayer(data: IMap<string, any>, next: NextFunc) {
    const client = this.getClient(data)
    const { slotId } = data.get('body')

    try {
      this.lobbyService.banPlayer({ client, slotId })
    } catch (err) {
      convertLobbyServiceError(err)
    }
  }

  @Api('/makeObserver')
  async makeObserver(data: IMap<string, any>, next: NextFunc) {
    const client = this.getClient(data)
    const { slotId } = data.get('body')

    try {
      this.lobbyService.makeObserver({ client, slotId })
    } catch (err) {
      convertLobbyServiceError(err)
    }
  }

  @Api('/removeObserver')
  async removeObserver(data: IMap<string, any>, next: NextFunc) {
    const client = this.getClient(data)
    const { slotId } = data.get('body')

    try {
      this.lobbyService.removeObserver({ client, slotId })
    } catch (err) {
      convertLobbyServiceError(err)
    }
  }

  @Api('/leave')
  async leave(data: IMap<string, any>, next: NextFunc) {
    const user = this.getUser(data)

    try {
      this.lobbyService.leaveLobby({ user })
    } catch (err) {
      convertLobbyServiceError(err)
    }
  }

  @Api('/startCountdown')
  async startCountdown(data: IMap<string, any>, next: NextFunc) {
    const client = this.getClient(data)

    try {
      await this.lobbyService.startCountdown({ client })
    } catch (err) {
      convertLobbyServiceError(err)
    }
  }

  @Api(
    '/getLobbyState',
    validateBody({
      lobbyId: nonEmptyString,
    }),
  )
  async getLobbyState(data: IMap<string, any>, next: NextFunc) {
    this.getClient(data)
    const { lobbyId } = data.get('body')

    return this.lobbyService.getLobbyState({ lobbyId })
  }

  getUser(data: IMap<string, any>): UserSocketsGroup {
    const user = this.userSockets.getBySocket(data.get('client'))
    if (!user) throw new errors.Unauthorized('authorization required')
    return user
  }

  getClient(data: IMap<string, any>): ClientSocketsGroup {
    const client = this.clientSockets.getCurrentClient(data.get('client'))
    if (!client) throw new errors.Unauthorized('authorization required')
    return client
  }
}

export default function registerApi(
  nydus: NydusServer,
  userSockets: UserSocketsManager,
  clientSockets: ClientSocketsManager,
) {
  const api = new LobbyApi(nydus, userSockets, clientSockets)
  registerApiRoutes(api, nydus)
  return api
}
