import errors from 'http-errors'
import { Mount, Api, registerApiRoutes } from '../websockets/api-decorators'
import validateBody from '../websockets/validate-body'

import pingRegistry from '../rally-point/ping-registry'

const MOUNT_BASE = '/rallyPoint'

const serverIndex = val => val >= 0 && val < pingRegistry.servers.length
const ping = val => val >= 0 && val <= Number.MAX_VALUE

@Mount(MOUNT_BASE)
class RallyPointApi {
  constructor(nydus, userSockets) {
    this.nydus = nydus
    this.userSockets = userSockets
    this.userSockets.on('newUser', user => this._handleNewUser(user))
      .on('userQuit', name => this._handleUserQuit(name))
  }

  @Api('/pingResult',
    validateBody({
      serverIndex,
      ping,
    }),
    'getUser')
  async pingResult(data, next) {
    const { serverIndex, ping } = data.get('body')
    const user = data.get('user')
    pingRegistry.addPing(user.name, serverIndex, ping)
  }

  async getUser(data, next) {
    const user = this.userSockets.getBySocket(data.get('client'))
    if (!user) throw new errors.Unauthorized('authorization required')
    const newData = data.set('user', user)

    return await next(newData)
  }

  _handleNewUser(user) {
    user.subscribe(`${MOUNT_BASE}/servers`, () => pingRegistry.servers)
  }

  _handleUserQuit(name) {
    pingRegistry.clearPings(name)
  }
}

export default function registerApi(nydus, userSockets) {
  const api = new RallyPointApi(nydus, userSockets)
  registerApiRoutes(api, nydus)
  return api
}
