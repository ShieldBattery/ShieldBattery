import errors from 'http-errors'
import { Map as IMap } from 'immutable'
import { NextFunc, NydusClient, NydusServer } from 'nydus'
import { container } from 'tsyringe'
import { SbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import { isPrettyId } from '../../../common/pretty-id'
import { Api, Mount, registerApiRoutes } from '../websockets/api-decorators'
import { ClientSocketsManager, UserSocketsManager } from '../websockets/socket-groups'
import validateBody from '../websockets/validate-body'
import { getLobbyPreviewPath, LOBBY_LIST_PATH, LobbyService } from './lobby-service'

interface ListSubscription {
  onUnsubscribe?: () => void
  count: number
}

interface PreviewSubscription {
  lobbyId: SbLobbyId
  onUnsubscribe: () => void
}

/**
 * The public lobby list: a socket can subscribe to receive the current set of listed lobbies plus
 * every subsequent change to it, and every connected client is subscribed to the open-lobby count.
 * A socket can additionally hold a preview of one lobby at a time, which carries that lobby's
 * seat-by-seat layout as it changes.
 *
 * Everything a client can *do* to a lobby lives on the HTTP API (`lobbies/lobby-api`); the socket
 * carries only server-to-client updates.
 */
@Mount(LOBBY_LIST_PATH)
export class LobbyListApi {
  readonly lobbyService = container.resolve(LobbyService)

  readonly subscribedSockets = new Map<string, ListSubscription>()
  readonly previewSockets = new Map<string, PreviewSubscription>()

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

  /**
   * Opens a preview of one lobby, replacing whichever lobby this socket was previewing before. A
   * client only ever looks at one lobby at a time, so the swap keeps it from having to unsubscribe
   * and resubscribe on every selection change (and from leaking subscriptions if it forgets).
   *
   * Holding a lobby's id is the capability to look at it, exactly as it is for the unauthenticated
   * summary endpoint, so an unlisted lobby previews fine — only a lobby that doesn't exist fails.
   */
  @Api(
    '/preview-subscribe',
    validateBody({
      lobbyId: (value: unknown) => typeof value === 'string' && isPrettyId(value),
    }),
  )
  async previewSubscribe(data: IMap<string, any>, next: NextFunc) {
    const socket = data.get('client') as NydusClient
    const lobbyId = data.get('body').lobbyId as SbLobbyId

    const preview = this.lobbyService.getPreview(lobbyId)
    if (!preview) {
      throw new errors.NotFound('lobby not found')
    }

    this.clearPreview(socket)

    const path = getLobbyPreviewPath(lobbyId)
    this.nydus.subscribeClient(socket, path, { action: 'preview', payload: preview })

    const onClose = () => {
      this.nydus.unsubscribeClient(socket, path)
      this.previewSockets.delete(socket.id)
    }
    socket.once('close', onClose)
    this.previewSockets.set(socket.id, {
      lobbyId,
      onUnsubscribe: () => socket.removeListener('close', onClose),
    })
  }

  @Api('/preview-unsubscribe')
  async previewUnsubscribe(data: IMap<string, any>, next: NextFunc) {
    const socket = data.get('client') as NydusClient
    if (!this.previewSockets.has(socket.id)) {
      throw new errors.Conflict('not subscribed')
    }

    this.clearPreview(socket)
  }

  /** Drops whatever preview `socket` holds, if it holds one. */
  private clearPreview(socket: NydusClient) {
    const subscription = this.previewSockets.get(socket.id)
    if (!subscription) {
      return
    }

    this.nydus.unsubscribeClient(socket, getLobbyPreviewPath(subscription.lobbyId))
    this.previewSockets.delete(socket.id)
    subscription.onUnsubscribe()
  }
}

export default function registerApi(
  nydus: NydusServer,
  userSockets: UserSocketsManager,
  clientSockets: ClientSocketsManager,
) {
  const api = new LobbyListApi(nydus, userSockets, clientSockets)
  registerApiRoutes(api, nydus)
  return api
}
