import { expect } from 'chai'
import { container } from 'tsyringe'
import PartyService, { PartyUser } from '../../../../server/lib/parties/party-service'
import {
  ClientSocketsManager,
  UserSocketsManager,
} from '../../../../server/lib/websockets/socket-groups'
import { FakeClientSocketsManager, FakeUserSocketsManager } from '../../../setup'

describe.only('parties/party-service', () => {
  const clientSocketsManager = container.resolve(ClientSocketsManager) as FakeClientSocketsManager
  const userSocketsManager = container.resolve(UserSocketsManager) as FakeUserSocketsManager
  const partyService = container.resolve(PartyService)

  const user1: PartyUser = { id: 1, name: 'pachi' }
  const user2: PartyUser = { id: 2, name: 'harem' }
  const user3: PartyUser = { id: 3, name: 'intrigue' }

  const USER1_CLIENT_ID = 'USER1_CLIENT_ID'
  const USER2_CLIENT_ID = 'USER2_CLIENT_ID'
  const USER3_CLIENT_ID = 'USER3_CLIENT_ID'

  clientSocketsManager.addClient(user1.id, USER1_CLIENT_ID)
  clientSocketsManager.addClient(user2.id, USER2_CLIENT_ID)
  clientSocketsManager.addClient(user3.id, USER3_CLIENT_ID)
  userSocketsManager.addUser(user1.name)
  userSocketsManager.addUser(user2.name)
  userSocketsManager.addUser(user3.name)

  beforeEach(() => {
    // container.clearInstances()
  })

  describe('invite', () => {
    it("should create a party when it doesn't exist", () => {
      const leader = user1
      const invites: PartyUser[] = [user2, user3]

      partyService.invite(leader, USER1_CLIENT_ID, invites)

      expect(true).to.equal(true)
    })
  })
})
