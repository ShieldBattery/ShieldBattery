import cuid from 'cuid'
import { Map, Record } from 'immutable'
import { NydusServer } from 'nydus'
import { singleton } from 'tsyringe'
import {
  ClientSocketsGroup,
  ClientSocketsManager,
  UserSocketsGroup,
  UserSocketsManager,
} from '../websockets/socket-groups'

const MAX_PARTY_SIZE = 8

export class PartyUser extends Record({
  id: null as number | null,
  name: null as string | null,
}) {}

export class PartyRecord extends Record({
  id: null as string | null,
  invites: Map<number | null, PartyUser>(),
  members: Map<number | null, PartyUser>(),
  leader: null as number | null,
}) {}

export enum PartyServiceErrorCode {
  PartyNotFound,
  NotPartyLeader,
  PartyFull,
  UserOffline,
}

export class PartyServiceError extends Error {
  public code: PartyServiceErrorCode

  constructor(code: PartyServiceErrorCode) {
    super()
    this.code = code
  }
}

function getInvitesPath(partyId: string): string {
  return `/parties/invites/${partyId}`
}

function getPartyPath(partyId: string): string {
  return `/parties/invites/${partyId}`
}

@singleton()
export default class PartyService {
  private parties = Map<string, PartyRecord>()
  private clientToPartyId = Map<ClientSocketsGroup, string>()

  constructor(
    private nydus: NydusServer,
    private clientSockets: ClientSocketsManager,
    private userSockets: UserSocketsManager,
  ) {}

  invite(leader: PartyUser, leaderClientId: string, invites: PartyUser[]) {
    const leaderClient = this.getClient(leader.id as number, leaderClientId)

    let party = this.getClientParty(leaderClient)
    if (party) {
      if (party.leader !== leader.id) {
        throw new PartyServiceError(PartyServiceErrorCode.NotPartyLeader)
      }

      const updatedParty = party.mergeIn('invites', Map(invites.map(i => [i.id, i])))
      this.parties = this.parties.set(party.id as string, updatedParty)

      this.publishToParty(party.id as string, {
        type: 'invite',
        invites,
      })
    } else {
      const partyId = cuid()
      party = new PartyRecord({
        id: partyId,
        invites: Map(invites.map(i => [i.id, i])),
        members: Map([[leader.id, leader]]),
        leader: leader.id,
      })

      this.parties = this.parties.set(partyId, party)
      this.clientToPartyId = this.clientToPartyId.set(leaderClient, partyId)
      this.subscribeToParty(leaderClient, party)
    }

    const inviteUsers = invites.map(i => this.getUser(i.name as string))
    inviteUsers.forEach(user => {
      user.subscribe(
        getInvitesPath(party!.id as string),
        () => ({
          action: 'invite',
          from: party!.leader,
        }),
        () => {
          // TODO(2Pac): Handle user quitting; need to keep a map of user -> invites?
        },
      )
    })
  }

  removeInvite(partyId: string, target: PartyUser, leader?: PartyUser) {
    const party = this.parties.get(partyId)
    if (!party) {
      throw new PartyServiceError(PartyServiceErrorCode.PartyNotFound)
    }

    if (leader && leader.id !== party.leader) {
      throw new PartyServiceError(PartyServiceErrorCode.NotPartyLeader)
    }

    const updatedParty = party.deleteIn(['invites', target.id])
    this.parties = this.parties.set(party.id as string, updatedParty)

    const targetUser = this.getUser(target.name as string)
    targetUser.unsubscribe(getInvitesPath(partyId))

    this.publishToParty(partyId, {
      type: 'decline',
      target,
    })

    // TODO(2Pac): Do we want to remove the party record if there's only one member left in a party
    // and no outstanding invites?
  }

  acceptInvite(partyId: string, user: PartyUser, clientId: string) {
    const client = this.getClient(user.id as number, clientId)

    const party = this.parties.get(partyId)
    if (!party) {
      throw new PartyServiceError(PartyServiceErrorCode.PartyNotFound)
    }

    if (party.members.size > MAX_PARTY_SIZE) {
      throw new PartyServiceError(PartyServiceErrorCode.PartyFull)
    }

    const oldParty = this.getClientParty(client)
    if (oldParty) {
      // TODO(2Pac): Handle switching parties
    }

    const updatedParty = party.deleteIn(['invites', user.id]).setIn(['members', user.id], user)
    this.parties = this.parties.set(party.id as string, updatedParty)
    this.clientToPartyId = this.clientToPartyId.set(client, partyId)

    this.publishToParty(partyId, {
      type: 'join',
      user,
    })

    const userSockets = this.getUser(user.name as string)
    userSockets.unsubscribe(getInvitesPath(partyId))
    this.subscribeToParty(client, updatedParty)
  }

  private subscribeToParty(client: ClientSocketsGroup, party: PartyRecord) {
    client.subscribe(
      getPartyPath(party.id as string),
      () => ({
        action: 'init',
        party,
      }),
      client => this.handleClientQuit(client),
    )
  }

  private handleClientQuit(client: ClientSocketsGroup) {
    const party = this.getClientParty(client)
    if (!party) {
      throw new PartyServiceError(PartyServiceErrorCode.PartyNotFound)
    }

    this.clientToPartyId.delete(client)
    this.parties = this.parties.deleteIn([party.id, 'members', client.userId])
    this.publishToParty(party.id as string, {
      type: 'leave',
      user: client.userId,
    })

    // TODO(2Pac): Handle party leader leaving

    // TODO(2Pac): Handle last person in a party leaving
  }

  private publishToParty(partyId: string, data: any) {
    this.nydus.publish(getPartyPath(partyId), data)
  }

  private getUser(username: string): UserSocketsGroup {
    const user = this.userSockets.getByName(username)
    if (!user) {
      throw new PartyServiceError(PartyServiceErrorCode.UserOffline)
    }

    return user
  }

  private getClient(userId: number, clientId: string): ClientSocketsGroup {
    const client = this.clientSockets.getById(userId, clientId)
    if (!client) {
      throw new PartyServiceError(PartyServiceErrorCode.UserOffline)
    }

    return client
  }

  private getClientParty(client: ClientSocketsGroup): PartyRecord | undefined {
    const partyId = this.clientToPartyId.get(client)
    return this.parties.get(partyId as string)
  }
}
