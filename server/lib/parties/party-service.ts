import cuid from 'cuid'
import { NydusServer } from 'nydus'
import { singleton } from 'tsyringe'
import logger from '../logging/logger'
import {
  ClientSocketsGroup,
  ClientSocketsManager,
  UserSocketsManager,
} from '../websockets/socket-groups'

/**
 * The maximum number of players allowed to be in the same party at once. Note that this only
 * restricts the amount of players *in* the party, it doesn't limit the number of invites to the
 * party.
 */
const MAX_PARTY_SIZE = 8

export interface PartyUser {
  id: number
  name: string
}

export interface PartyRecord {
  id: string
  invites: Map<number, PartyUser>
  members: Map<number, PartyUser>
  leader: PartyUser
}

export enum PartyServiceErrorCode {
  PartyNotFound,
  InsufficientPermissions,
  PartyFull,
  UserOffline,
  InvalidAction,
}

export class PartyServiceError extends Error {
  constructor(readonly code: PartyServiceErrorCode, message: string) {
    super(message)
  }
}

export function getInvitesPath(partyId: string, userId: number): string {
  return `/parties/invites/${partyId}/${userId}`
}

export function getPartyPath(partyId: string): string {
  return `/parties/${partyId}`
}

export interface PartyJson {
  id: string
  invites: Array<PartyUser>
  members: Array<PartyUser>
  leader: PartyUser
}

export function toPartyJson(party: PartyRecord): PartyJson {
  return {
    id: party.id,
    invites: Array.from(party.invites.values()),
    members: Array.from(party.members.values()),
    leader: party.leader,
  }
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

    if (invites.some(i => i.id === leader.id)) {
      throw new PartyServiceError(
        PartyServiceErrorCode.InvalidAction,
        "Can't invite yourself to the party",
      )
    }

    let party = this.getClientParty(leaderClientSockets)
    if (party) {
      if (party.leader.id !== leader.id) {
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
        leader,
      }

      this.parties.set(partyId, party)
      this.clientSocketsToPartyId.set(leaderClientSockets, partyId)
      this.subscribeToParty(leaderClientSockets, party)
    }

    invites.forEach(i => {
      // TODO(2Pac): Send the invite notification once the server-side notification system is in.
      const userSockets = this.userSocketsManager.getByName(i.name)
      if (userSockets) {
        userSockets.subscribe(
          getInvitesPath(party!.id, userSockets.userId),
          () => ({
            type: 'addInvite',
            from: leader,
          }),
          () => {
            // TODO(2Pac): Handle user quitting; need to keep a map of user -> invites?
          },
        )
      }
    })

    return party
  }

  decline(partyId: string, target: PartyUser) {
    const party = this.parties.get(partyId)
    if (!party) {
      throw new PartyServiceError(PartyServiceErrorCode.PartyNotFound, 'Party not found')
    }

    if (!party.invites.has(target.id)) {
      throw new PartyServiceError(
        PartyServiceErrorCode.InsufficientPermissions,
        "Can't decline a party invitation without an invite",
      )
    }

    party.invites.delete(target.id)

    this.publishToParty(partyId, {
      type: 'decline',
      target,
    })

    // TODO(2Pac): Do we want to remove the party record if there's only one member left in a party
    // and no outstanding invites?

    this.unsubscribeFromInvites(party, target)
  }

  removeInvite(partyId: string, removingUser: PartyUser, target: PartyUser) {
    const party = this.parties.get(partyId)
    if (!party) {
      throw new PartyServiceError(PartyServiceErrorCode.PartyNotFound, 'Party not found')
    }

    if (removingUser.id !== party.leader.id) {
      throw new PartyServiceError(
        PartyServiceErrorCode.InsufficientPermissions,
        'Only party leaders can remove invites to other people',
      )
    }

    if (!party.invites.has(target.id)) {
      throw new PartyServiceError(
        PartyServiceErrorCode.InvalidAction,
        "Can't remove invite for a user that wasn't invited",
      )
    }

    party.invites.delete(target.id)

    // TODO(2Pac): Publish *something* to the party that an invite was removed?

    // TODO(2Pac): Do we want to remove the party record if there's only one member left in a party
    // and no outstanding invites?

    this.unsubscribeFromInvites(party, target)
  }

  acceptInvite(partyId: string, user: PartyUser, clientId: string) {
    const clientSockets = this.getClientSockets(user.id, clientId)

    const party = this.parties.get(partyId)
    if (!party) {
      throw new PartyServiceError(PartyServiceErrorCode.PartyNotFound, 'Party not found')
    }

    if (party.members.size >= MAX_PARTY_SIZE) {
      throw new PartyServiceError(PartyServiceErrorCode.PartyFull, 'Party is full')
    }

    if (!party.invites.has(user.id)) {
      throw new PartyServiceError(
        PartyServiceErrorCode.InsufficientPermissions,
        "Can't join party without an invite",
      )
    }

    const userParty = this.getClientParty(clientSockets)
    if (userParty) {
      // TODO(2Pac): Handle switching parties
    }

    party.invites.delete(user.id)
    party.members.set(user.id, user)
    this.clientSocketsToPartyId.set(clientSockets, partyId)

    this.publishToParty(partyId, {
      type: 'join',
      user,
    })

    this.unsubscribeFromInvites(party, user)
    this.subscribeToParty(clientSockets, party)
  }

  private unsubscribeFromInvites(party: PartyRecord, user: PartyUser) {
    this.nydus.publish(getInvitesPath(party.id, user.id), { type: 'removeInvite' })
    // TODO(2Pac): Remove the invite notification once the server-side notification system is in.
    const userSockets = this.userSocketsManager.getByName(user.name)
    if (userSockets) {
      userSockets.unsubscribe(getInvitesPath(party.id, user.id))
    }
  }

  private subscribeToParty(clientSockets: ClientSocketsGroup, party: PartyRecord) {
    clientSockets.subscribe(
      getPartyPath(party.id),
      () => ({
        type: 'init',
        party: toPartyJson(party),
      }),
      sockets => this.handleClientQuit(sockets),
    )
  }

  private handleClientQuit(clientSockets: ClientSocketsGroup) {
    const party = this.getClientParty(clientSockets)
    if (!party) {
      logger.error('error while handling client quitting, party not found')
      return
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

  private getClientSockets(userId: number, clientId: string): ClientSocketsGroup {
    const clientSockets = this.clientSocketsManager.getById(userId, clientId)
    if (!clientSockets) {
      throw new PartyServiceError(PartyServiceErrorCode.UserOffline, 'Client could not be found')
    }

    return clientSockets
  }

  private getClientParty(clientSockets: ClientSocketsGroup): PartyRecord | undefined {
    const partyId = this.clientSocketsToPartyId.get(clientSockets)
    return this.parties.get(partyId as string)
  }
}
