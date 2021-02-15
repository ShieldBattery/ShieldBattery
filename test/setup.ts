import 'core-js/proposals/reflect-metadata'
import { NydusClient, NydusServer } from 'nydus'
import { container, instanceCachingFactory } from 'tsyringe'
import { UpdateOrInsertUserIp } from '../server/lib/network/user-ips-type'
import { RequestSessionLookup, SessionInfo } from '../server/lib/websockets/session-lookup'
import {
  ClientSocketsGroup,
  ClientSocketsManager,
  UserSocketsGroup,
  UserSocketsManager,
} from '../server/lib/websockets/socket-groups'

export class FakeNydusServer extends NydusServer {
  publish() {
    console.log('FakeNydusServer - publish')
  }
}

export class FakeUserSocketsManager extends UserSocketsManager {
  addUser(userName: string) {
    const session = { userName } as SessionInfo
    const user = new UserSocketsGroup(this.nydus, session!, new NydusClient())
    this.users = this.users.set(userName, user)
  }
}

export class FakeClientSocketsManager extends ClientSocketsManager {
  addClient(userId: number, clientId: string) {
    const userClientId = `${userId}|${clientId}`
    const session = { userId, clientId } as SessionInfo
    const client = new ClientSocketsGroup(this.nydus, session, new NydusClient())
    this.clients = this.clients.set(userClientId, client)
  }
}

container.register<NydusServer>(NydusServer, FakeNydusServer)
container.register('updateOrInsertUserIp', { useValue: () => {} })

const nydus = container.resolve(NydusServer)
const sessionLookup = container.resolve(RequestSessionLookup)
const updateOrInsertUserIp = container.resolve('updateOrInsertUserIp') as UpdateOrInsertUserIp

container.register<UserSocketsManager>(UserSocketsManager, {
  useFactory: instanceCachingFactory(
    () => new FakeUserSocketsManager(nydus, sessionLookup, updateOrInsertUserIp),
  ),
})
container.register<ClientSocketsManager>(ClientSocketsManager, {
  useFactory: instanceCachingFactory(() => new FakeClientSocketsManager(nydus, sessionLookup)),
})
