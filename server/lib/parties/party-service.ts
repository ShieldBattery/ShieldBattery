import cuid from 'cuid'
import { NydusServer } from 'nydus'
import { singleton } from 'tsyringe'
import {
  ClientSocketsGroup,
  ClientSocketsManager,
  UserSocketsGroup,
  UserSocketsManager,
} from '../websockets/socket-groups'

const MAX_PARTY_SIZE = 8

export interface PartyUser {
  id: number
  name: string
}

export interface PartyRecord {
  id: string
  invites: Map<number, PartyUser>
  members: Map<number, PartyUser>
  leader: number
}

export enum PartyServiceErrorCode {
  PartyNotFound,
  InsufficientPermissions,
  PartyFull,
  UserOffline,
}

export class PartyServiceError extends Error {
  public code: PartyServiceErrorCode

  constructor(code: PartyServiceErrorCode, message: string) {
    super(message)
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
  private parties = new Map<string, PartyRecord>()
  private clientToPartyId = new Map<ClientSocketsGroup, string>()

  constructor(
    private nydus: NydusServer,
    private clientSockets: ClientSocketsManager,
    private userSockets: UserSocketsManager,
  ) {}

  invite(leader: PartyUser, leaderClientId: string, invites: PartyUser[]) {
    const leaderClient = this.getClient(leader.id, leaderClientId)

    let party: PartyRecord | undefined = this.getClientParty(leaderClient)
    if (party) {
      if (party.leader !== leader.id) {
        throw new PartyServiceError(
          PartyServiceErrorCode.InsufficientPermissions,
          'Only party leader can invite people',
        )
      }

      for (const invite of invites) {
        party.invites.set(invite.id, invite)
      }

      this.publishToParty(party.id, {
        type: 'invite',
        invites,
      })
    } else {
      const partyId = cuid()
      party = {
        id: partyId,
        invites: new Map(invites.map(i => [i.id, i])),
        members: new Map([[leader.id, leader]]),
        leader: leader.id,
      }

      this.parties.set(partyId, party)
      this.clientToPartyId.set(leaderClient, partyId)
      this.subscribeToParty(leaderClient, party)
    }

    const inviteUsers = invites.map(i => this.getUser(i.name))
    inviteUsers.forEach(user => {
      user.subscribe(
        getInvitesPath(party!.id),
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
      throw new PartyServiceError(PartyServiceErrorCode.PartyNotFound, 'Party not found')
    }

    if (leader && leader.id !== party.leader) {
      throw new PartyServiceError(
        PartyServiceErrorCode.InsufficientPermissions,
        'Only party leaders can remove invites to other people',
      )
    }

    party.invites.delete(target.id)
    this.publishToParty(partyId, {
      type: 'decline',
      target,
    })

    // TODO(2Pac): Do we want to remove the party record if there's only one member left in a party
    // and no outstanding invites?

    const targetUser = this.getUser(target.name)
    targetUser.unsubscribe(getInvitesPath(partyId))
  }

  acceptInvite(partyId: string, user: PartyUser, clientId: string) {
    const client = this.getClient(user.id, clientId)

    const party = this.parties.get(partyId)
    if (!party) {
      throw new PartyServiceError(PartyServiceErrorCode.PartyNotFound, 'Party not found')
    }

    if (party.members.size > MAX_PARTY_SIZE) {
      throw new PartyServiceError(PartyServiceErrorCode.PartyFull, 'Party is full')
    }

    const oldParty = this.getClientParty(client)
    if (oldParty) {
      // TODO(2Pac): Handle switching parties
    }

    party.invites.delete(user.id)
    party.members.set(user.id, user)
    this.clientToPartyId.set(client, partyId)

    this.publishToParty(partyId, {
      type: 'join',
      user,
    })

    const userSockets = this.getUser(user.name)
    userSockets.unsubscribe(getInvitesPath(partyId))
    this.subscribeToParty(client, party)
  }

  private subscribeToParty(client: ClientSocketsGroup, party: PartyRecord) {
    client.subscribe(
      getPartyPath(party.id),
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
      throw new PartyServiceError(PartyServiceErrorCode.PartyNotFound, 'Party not found')
    }

    party.members.delete(client.userId)
    this.clientToPartyId.delete(client)
    this.publishToParty(party.id, {
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
      throw new PartyServiceError(PartyServiceErrorCode.UserOffline, 'User is offline')
    }

    return user
  }

  private getClient(userId: number, clientId: string): ClientSocketsGroup {
    const client = this.clientSockets.getById(userId, clientId)
    if (!client) {
      throw new PartyServiceError(PartyServiceErrorCode.UserOffline, 'Authorization required')
    }

    return client
  }

  private getClientParty(client: ClientSocketsGroup): PartyRecord | undefined {
    const partyId = this.clientToPartyId.get(client)
    return this.parties.get(partyId as string)
  }
}
