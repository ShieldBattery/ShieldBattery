import { NydusServer } from 'nydus'
import { RequestSessionLookup } from '../websockets/session-lookup'
import { ClientSocketsManager, UserSocketsManager } from '../websockets/socket-groups'
import {
  clearTestLogs,
  createFakeNydusServer,
  InspectableNydusClient,
  NydusConnector,
} from '../websockets/testing/websockets'
import PartyService, { getPartyPath, PartyUser } from './party-service'

describe('parties/party-service', () => {
  const user1: PartyUser = { id: 1, name: 'pachi' }
  const user2: PartyUser = { id: 2, name: 'harem' }
  const user3: PartyUser = { id: 3, name: 'intrigue' }

  const USER1_CLIENT_ID = 'USER1_CLIENT_ID'
  const USER2_CLIENT_ID = 'USER2_CLIENT_ID'
  const USER3_CLIENT_ID = 'USER3_CLIENT_ID'

  let client1: InspectableNydusClient
  let client2: InspectableNydusClient
  let client3: InspectableNydusClient

  let nydus: NydusServer
  let partyService: PartyService
  let connector: NydusConnector

  beforeEach(() => {
    nydus = createFakeNydusServer()
    const sessionLookup = new RequestSessionLookup()
    const userSocketsManager = new UserSocketsManager(nydus, sessionLookup, async () => {})
    const clientSocketsManager = new ClientSocketsManager(nydus, sessionLookup)
    partyService = new PartyService(nydus, clientSocketsManager, userSocketsManager)
    connector = new NydusConnector(nydus, sessionLookup)

    client1 = connector.connectClient(user1, USER1_CLIENT_ID)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    client2 = connector.connectClient(user2, USER2_CLIENT_ID)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    client3 = connector.connectClient(user3, USER3_CLIENT_ID)

    clearTestLogs(nydus)
  })

  describe('invite', () => {
    test("should create a party when it doesn't exist", () => {
      const leader = user1
      const invites: PartyUser[] = [user2, user3]

      const party = partyService.invite(leader, USER1_CLIENT_ID, invites)

      expect(party.invites.size).toBe(2)
      expect(client1.publish).toHaveBeenCalledWith(getPartyPath(party.id), {
        action: 'init',
        party,
      })
    })
  })
})
