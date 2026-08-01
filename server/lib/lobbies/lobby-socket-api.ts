import errors from 'http-errors'
import { Map as IMap } from 'immutable'
import { NextFunc, NydusClient, NydusServer } from 'nydus'
import { container } from 'tsyringe'
import { Api, Mount, registerApiRoutes } from '../websockets/api-decorators'
import { ClientSocketsManager, UserSocketsManager } from '../websockets/socket-groups'
import { LOBBY_LIST_PATH, LobbyService } from './lobby-service'

interface ListSubscription {
  onUnsubscribe?: () => void
  count: number
}

/**
 * The public lobby list: a socket can subscribe to receive the current set of listed lobbies plus
 * every subsequent change to it, and every connected client is subscribed to the open-lobby count.
 *
 * Everything a client can *do* to a lobby lives on the HTTP API (`lobbies/lobby-api`); the socket
 * carries only server-to-client updates.
 */
@Mount(LOBBY_LIST_PATH)
export class LobbyListApi {
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
