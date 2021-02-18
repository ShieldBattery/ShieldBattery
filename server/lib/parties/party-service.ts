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

export function getInvitesPath(partyId: string): string {
  return `/parties/invites/${partyId}`
}

export function getPartyPath(partyId: string): string {
  return `/parties/invites/${partyId}`
}

@singleton()
export default class PartyService {
  private parties = new Map<string, PartyRecord>()
  private clientSocketsToPartyId = new Map<ClientSocketsGroup, string>()

  constructor(
    private nydus: NydusServer,
    private clientSocketsManager: ClientSocketsManager,
    private userSocketsManager: UserSocketsManager,
  ) {}

  invite(leader: PartyUser, leaderClientId: string, invites: PartyUser[]): Readonly<PartyRecord> {
    const leaderClientSockets = this.getClientSockets(leader.id, leaderClientId)

    let party: PartyRecord | undefined = this.getClientParty(leaderClientSockets)
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
      this.clientSocketsToPartyId.set(leaderClientSockets, partyId)
      this.subscribeToParty(leaderClientSockets, party)
    }

    invites
      .map(i => this.getUserSockets(i.name))
      .forEach(userSockets => {
        userSockets.subscribe(
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

    return party
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

    const targetUserSockets = this.getUserSockets(target.name)
    targetUserSockets.unsubscribe(getInvitesPath(partyId))
  }

  acceptInvite(partyId: string, user: PartyUser, clientId: string) {
    const clientSockets = this.getClientSockets(user.id, clientId)

    const party = this.parties.get(partyId)
    if (!party) {
      throw new PartyServiceError(PartyServiceErrorCode.PartyNotFound, 'Party not found')
    }

    if (party.members.size > MAX_PARTY_SIZE) {
      throw new PartyServiceError(PartyServiceErrorCode.PartyFull, 'Party is full')
    }

    const oldParty = this.getClientParty(clientSockets)
    if (oldParty) {
      // TODO(2Pac): Handle switching parties
    }

    party.invites.delete(user.id)
    party.members.set(user.id, user)
    this.clientSocketsToPartyId.set(clientSockets, partyId)

    this.publishToParty(partyId, {
      type: 'join',
      user,
    })

    const userSockets = this.getUserSockets(user.name)
    userSockets.unsubscribe(getInvitesPath(partyId))
    this.subscribeToParty(clientSockets, party)
  }

  private subscribeToParty(clientSockets: ClientSocketsGroup, party: PartyRecord) {
    clientSockets.subscribe(
      getPartyPath(party.id),
      () => ({
        action: 'init',
        party,
      }),
      sockets => this.handleClientQuit(sockets),
    )
  }

  private handleClientQuit(clientSockets: ClientSocketsGroup) {
    const party = this.getClientParty(clientSockets)
    if (!party) {
      throw new PartyServiceError(PartyServiceErrorCode.PartyNotFound, 'Party not found')
    }

    party.members.delete(clientSockets.userId)
    this.clientSocketsToPartyId.delete(clientSockets)
    this.publishToParty(party.id, {
      type: 'leave',
      user: clientSockets.userId,
    })

    // TODO(2Pac): Handle party leader leaving

    // TODO(2Pac): Handle last person in a party leaving
  }

  private publishToParty(partyId: string, data: any) {
    this.nydus.publish(getPartyPath(partyId), data)
  }

  private getUserSockets(username: string): UserSocketsGroup {
    const userSockets = this.userSocketsManager.getByName(username)
    if (!userSockets) {
      throw new PartyServiceError(PartyServiceErrorCode.UserOffline, 'User is offline')
    }

    return userSockets
  }

  private getClientSockets(userId: number, clientId: string): ClientSocketsGroup {
    const clientSockets = this.clientSocketsManager.getById(userId, clientId)
    if (!clientSockets) {
      throw new PartyServiceError(PartyServiceErrorCode.UserOffline, 'Authorization required')
    }

    return clientSockets
  }

  private getClientParty(clientSockets: ClientSocketsGroup): PartyRecord | undefined {
    const partyId = this.clientSocketsToPartyId.get(clientSockets)
    return this.parties.get(partyId as string)
  }
}
