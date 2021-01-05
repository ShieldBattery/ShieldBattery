import errors from 'http-errors'
import { Map } from 'immutable'
import { Mount, Api, registerApiRoutes } from '../websockets/api-decorators'
import validateBody from '../websockets/validate-body'

import pingRegistry from '../rally-point/ping-registry'
import { UserSocketsGroup, UserSocketsManager } from '../websockets/socket-groups'
import { NydusServer } from 'nydus'
import { container, singleton } from 'tsyringe'
import { NextFunc } from 'nydus/dist/composer'

const MOUNT_BASE = '/rallyPoint'

const serverIndex = (val: number) => val >= 0 && val < pingRegistry.servers.length
const ping = (val: number) => val >= 0 && val <= Number.MAX_VALUE

@singleton()
@Mount(MOUNT_BASE)
class RallyPointApi {
  constructor(private userSockets: UserSocketsManager) {
    this.userSockets
      .on('newUser', user => this.handleNewUser(user))
      .on('userQuit', name => this.handleUserQuit(name))
  }

  @Api(
    '/pingResult',
    validateBody({
      serverIndex,
      ping,
    }),
    'getUser',
  )
  async pingResult(data: Map<string, any>, next: NextFunc) {
    const { serverIndex, ping } = data.get('body')
    const user = data.get('user')
    pingRegistry.addPing(user.name, serverIndex, ping)
  }

  async getUser(data: Map<string, any>, next: NextFunc) {
    const user = this.userSockets.getBySocket(data.get('client'))
    if (!user) throw new errors.Unauthorized('authorization required')
    const newData = data.set('user', user)

    return next(newData)
  }

  private handleNewUser(user: UserSocketsGroup) {
    user.subscribe(`${MOUNT_BASE}/servers`, () => pingRegistry.servers)
  }

  private handleUserQuit(name: string) {
    pingRegistry.clearPings(name)
  }
}

export default function registerApi(nydus: NydusServer) {
  const api = container.resolve(RallyPointApi)
  registerApiRoutes(api, nydus)
  return api
}
