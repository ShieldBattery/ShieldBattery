import { NydusServer } from 'nydus'
import { RequestSessionLookup } from '../websockets/session-lookup'
import { ClientSocketsManager, UserSocketsManager } from '../websockets/socket-groups'
import {
  clearTestLogs,
  createFakeNydusServer,
  InspectableNydusClient,
  NydusConnector,
} from '../websockets/testing/websockets'
import PartyService, { getInvitesPath, getPartyPath, PartyRecord, PartyUser } from './party-service'

describe('parties/party-service', () => {
  const user1: PartyUser = { id: 1, name: 'pachi' }
  const user2: PartyUser = { id: 2, name: 'harem' }
  const user3: PartyUser = { id: 3, name: 'intrigue' }
  const user4: PartyUser = { id: 4, name: 'tec27' }
  const user5: PartyUser = { id: 5, name: 'heyoka' }
  const user6: PartyUser = { id: 6, name: 'hot_bid' }
  const user7: PartyUser = { id: 7, name: 'royo' }
  const user8: PartyUser = { id: 8, name: 'riptide' }
  const user9: PartyUser = { id: 9, name: 'manifesto7' }

  const USER1_CLIENT_ID = 'USER1_CLIENT_ID'
  const USER2_CLIENT_ID = 'USER2_CLIENT_ID'
  const USER3_CLIENT_ID = 'USER3_CLIENT_ID'
  const USER4_CLIENT_ID = 'USER4_CLIENT_ID'
  const USER5_CLIENT_ID = 'USER5_CLIENT_ID'
  const USER6_CLIENT_ID = 'USER6_CLIENT_ID'
  const USER7_CLIENT_ID = 'USER7_CLIENT_ID'
  const USER8_CLIENT_ID = 'USER8_CLIENT_ID'
  const USER9_CLIENT_ID = 'USER9_CLIENT_ID'

  let client1: InspectableNydusClient
  let client2: InspectableNydusClient
  let client3: InspectableNydusClient
  let client4: InspectableNydusClient
  let client5: InspectableNydusClient
  let client6: InspectableNydusClient
  let client7: InspectableNydusClient
  let client8: InspectableNydusClient
  let client9: InspectableNydusClient

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
    client2 = connector.connectClient(user2, USER2_CLIENT_ID)
    client3 = connector.connectClient(user3, USER3_CLIENT_ID)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    client4 = connector.connectClient(user4, USER4_CLIENT_ID)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    client5 = connector.connectClient(user5, USER5_CLIENT_ID)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    client6 = connector.connectClient(user6, USER6_CLIENT_ID)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    client7 = connector.connectClient(user7, USER7_CLIENT_ID)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    client8 = connector.connectClient(user8, USER8_CLIENT_ID)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    client9 = connector.connectClient(user9, USER9_CLIENT_ID)

    clearTestLogs(nydus)
  })

  describe('invite', () => {
    let leader: PartyUser
    let party: PartyRecord

    describe('when party exists', () => {
      beforeEach(() => {
        leader = user1
        party = partyService.invite(leader, USER1_CLIENT_ID, [user2])
        partyService.acceptInvite(party.id, user2, USER2_CLIENT_ID)
      })

      test('should throw if invited by non-leader', () => {
        const result = () => partyService.invite(user2, USER2_CLIENT_ID, [user3])

        expect(result).toThrow()
      })

      test('should update the party record', () => {
        party = partyService.invite(leader, USER1_CLIENT_ID, [user3])

        expect(party.invites).toMatchObject(new Map([[user3.id, user3]]))
      })

      test('should publish "invite" message to the party path', () => {
        party = partyService.invite(leader, USER1_CLIENT_ID, [user3])

        expect(nydus.publish).toHaveBeenCalledWith(getPartyPath(party.id), {
          type: 'invite',
          invites: [user3],
        })
      })
    })

    describe("when party doesn't exist", () => {
      beforeEach(() => {
        leader = user1
        party = partyService.invite(leader, USER1_CLIENT_ID, [user2, user3])
      })

      test('should create a party record', () => {
        expect(party).toMatchObject({
          id: party.id,
          invites: new Map([
            [user2.id, user2],
            [user3.id, user3],
          ]),
          members: new Map([[leader.id, leader]]),
          leaderId: leader.id,
        })
      })

      test('should subscribe leader to the party path', () => {
        expect(client1.publish).toHaveBeenCalledWith(getPartyPath(party.id), {
          type: 'init',
          party,
        })
      })
    })

    test('should subscribe invited users to the invites path', () => {
      leader = user1
      party = partyService.invite(leader, USER1_CLIENT_ID, [user2, user3])

      expect(client2.publish).toHaveBeenCalledWith(getInvitesPath(party.id), {
        type: 'invite',
        from: party.leaderId,
      })
      expect(client3.publish).toHaveBeenCalledWith(getInvitesPath(party.id), {
        type: 'invite',
        from: party.leaderId,
      })
    })
  })

  describe('removeInvite', () => {
    let leader: PartyUser
    let party: PartyRecord

    beforeEach(() => {
      leader = user1
      party = partyService.invite(leader, USER1_CLIENT_ID, [user2, user3])
    })

    test('should throw if the party is not found', () => {
      const result = () => partyService.removeInvite('INVALID_PARTY_ID', user2)

      expect(result).toThrow()
    })

    test('should throw if removed by non-leader', () => {
      const result = () => partyService.removeInvite(party.id, user2, user3)

      expect(result).toThrow()
    })

    test('should update the party record when declined', () => {
      partyService.removeInvite(party.id, user2)

      expect(party.invites).toMatchObject(new Map([[user3.id, user3]]))
    })

    test('should update the party record removed by leader', () => {
      partyService.removeInvite(party.id, user2, leader)

      expect(party.invites).toMatchObject(new Map([[user3.id, user3]]))
    })

    test('should publish "decline" message to the party path', () => {
      partyService.removeInvite(party.id, user2)

      expect(nydus.publish).toHaveBeenCalledWith(getPartyPath(party.id), {
        type: 'decline',
        target: user2,
      })
    })

    test('should unsubscribe user from the invites path', () => {
      partyService.removeInvite(party.id, user2)

      expect(nydus.unsubscribeClient).toHaveBeenCalledWith(client2, getInvitesPath(party.id))
    })
  })

  describe('acceptInvite', () => {
    let leader: PartyUser
    let party: PartyRecord

    beforeEach(() => {
      leader = user1
      party = partyService.invite(leader, USER1_CLIENT_ID, [user2, user3])
    })

    test('should throw if the party is not found', () => {
      const result = () => partyService.acceptInvite('INVALID_PARTY_ID', user2, USER2_CLIENT_ID)

      expect(result).toThrow()
    })

    test('should throw if the party is full', () => {
      party = partyService.invite(leader, USER1_CLIENT_ID, [user4, user5, user6, user7, user8])
      partyService.acceptInvite(party.id, user2, USER2_CLIENT_ID)
      partyService.acceptInvite(party.id, user3, USER3_CLIENT_ID)
      partyService.acceptInvite(party.id, user4, USER4_CLIENT_ID)
      partyService.acceptInvite(party.id, user5, USER5_CLIENT_ID)
      partyService.acceptInvite(party.id, user6, USER6_CLIENT_ID)
      partyService.acceptInvite(party.id, user7, USER7_CLIENT_ID)
      partyService.acceptInvite(party.id, user8, USER8_CLIENT_ID)

      party = partyService.invite(leader, USER1_CLIENT_ID, [user9])
      const result = () => partyService.acceptInvite(party.id, user9, USER9_CLIENT_ID)

      expect(result).toThrow()
    })

    test('should update the party record', () => {
      partyService.acceptInvite(party.id, user2, USER2_CLIENT_ID)

      expect(party.invites).toMatchObject(new Map([[user3.id, user3]]))
      expect(party.members).toMatchObject(
        new Map([
          [leader.id, leader],
          [user2.id, user2],
        ]),
      )
    })

    test('should publish "join" message to the party path', () => {
      partyService.acceptInvite(party.id, user2, USER2_CLIENT_ID)

      // TODO(2Pac): Test the order of this call? This should probably be ensured that it's called
      // before subscribing the user to the party path.
      expect(nydus.publish).toHaveBeenCalledWith(getPartyPath(party.id), {
        type: 'join',
        user: user2,
      })
    })

    test('should unsubscribe user from the invites path', () => {
      partyService.acceptInvite(party.id, user2, USER2_CLIENT_ID)

      expect(nydus.unsubscribeClient).toHaveBeenCalledWith(client2, getInvitesPath(party.id))
    })

    test('should subscribe user to the party path', () => {
      expect(client1.publish).toHaveBeenCalledWith(getPartyPath(party.id), {
        type: 'init',
        party,
      })
    })
  })
})
