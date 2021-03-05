import cuid from 'cuid'
import { NydusServer } from 'nydus'
import { container, singleton } from 'tsyringe'
import { NotificationType } from '../../../common/notifications'
import {
  MAX_PARTY_SIZE,
  PartyAddInviteEvent,
  PartyDeclineEvent,
  PartyInitEvent,
  PartyInviteEvent,
  PartyJoinEvent,
  PartyLeaveEvent,
  PartyPayload,
  PartyRemoveInviteEvent,
  PartyUser,
} from '../../../common/parties'
import logger from '../logging/logger'
import { retrieveNotifications } from '../notifications/notification-model'
import NotificationService from '../notifications/notification-service'
import {
  ClientSocketsGroup,
  ClientSocketsManager,
  UserSocketsManager,
} from '../websockets/socket-groups'

const notificationService = container.resolve(NotificationService)

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

export function toPartyJson(party: PartyRecord): PartyPayload {
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

      if (invites.some(i => party?.invites.has(i.id))) {
        throw new PartyServiceError(
          PartyServiceErrorCode.InvalidAction,
          'An invite already exists for this user',
        )
      }

      if (invites.some(i => party?.members.has(i.id))) {
        throw new PartyServiceError(
          PartyServiceErrorCode.InvalidAction,
          'This user is already a member of this party',
        )
      }

      for (const invite of invites) {
        party.invites.set(invite.id, invite)
      }

      const inviteEventData: PartyInviteEvent = {
        type: 'invite',
        invites,
      }
      this.publishToParty(party.id, inviteEventData)
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
      const userId = i.id
      const partyId = party!.id
      const userSockets = this.userSocketsManager.getByName(i.name)
      if (userSockets) {
        const addInviteEventData: PartyAddInviteEvent = {
          type: 'addInvite',
          from: leader,
        }
        userSockets.subscribe(
          getInvitesPath(partyId, userId),
          () => addInviteEventData,
          () => {
            // TODO(2Pac): Handle user quitting; need to keep a map of user -> invites?
          },
        )
      }

      // TODO(2Pac): Handle errors here. If the notification is not sent, then the invite doesn't
      // make much sense, and needs to be cleaned up.
      notificationService.addNotification({
        userId,
        data: {
          type: NotificationType.PartyInvite,
          from: leader.name,
          partyId,
        },
      })
    })

    return party
  }

  decline(partyId: string, target: PartyUser) {
    // TODO(2Pac): Do we need to await this?
    this.unsubscribeFromInvites(partyId, target)

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

    const declineEventData: PartyDeclineEvent = {
      type: 'decline',
      target,
    }
    this.publishToParty(partyId, declineEventData)

    // TODO(2Pac): Do we want to remove the party record if there's only one member left in a party
    // and no outstanding invites?
  }

  removeInvite(partyId: string, removingUser: PartyUser, target: PartyUser) {
    // TODO(2Pac): Do we need to await this?
    this.unsubscribeFromInvites(partyId, target)

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
  }

  acceptInvite(partyId: string, user: PartyUser, clientId: string) {
    // TODO(2Pac): Do we need to await this?
    this.unsubscribeFromInvites(partyId, user)

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

    // TODO(2Pac): Only allow accepting an invite for electron clients?

    const clientSockets = this.getClientSockets(user.id, clientId)
    const userParty = this.getClientParty(clientSockets)
    if (userParty) {
      // TODO(2Pac): Handle switching parties
    }

    party.invites.delete(user.id)
    party.members.set(user.id, user)
    this.clientSocketsToPartyId.set(clientSockets, partyId)

    const joinEventData: PartyJoinEvent = {
      type: 'join',
      user,
    }
    this.publishToParty(partyId, joinEventData)
    this.subscribeToParty(clientSockets, party)
  }

  private async unsubscribeFromInvites(partyId: string, user: PartyUser) {
    const removeInviteEventData: PartyRemoveInviteEvent = {
      type: 'removeInvite',
    }
    this.nydus.publish(getInvitesPath(partyId, user.id), removeInviteEventData)

    const userSockets = this.userSocketsManager.getByName(user.name)
    if (userSockets) {
      userSockets.unsubscribe(getInvitesPath(partyId, user.id))
    }

    // TODO(2Pac): Handle errors here?
    const userInviteNotifications = await retrieveNotifications({
      userId: user.id,
      type: NotificationType.PartyInvite,
    })
    const notification = userInviteNotifications.filter(n => n.data.partyId === partyId)[0]
    if (notification) {
      // TODO(2Pac): Do we need to await this? Handle errors here?
      notificationService.clearById(user.id, notification.id)
    }
  }

  private subscribeToParty(clientSockets: ClientSocketsGroup, party: PartyRecord) {
    const initEventData: PartyInitEvent = {
      type: 'init',
      party: toPartyJson(party),
    }
    clientSockets.subscribe(
      getPartyPath(party.id),
      () => initEventData,
      sockets => this.handleClientQuit(sockets),
    )
  }

  private handleClientQuit(clientSockets: ClientSocketsGroup) {
    const party = this.getClientParty(clientSockets)
    if (!party) {
      logger.error('error while handling client quitting, party not found')
      return
    }

    this.clientSocketsToPartyId.delete(clientSockets)

    const user = party.members.get(clientSockets.userId)
    if (user) {
      party.members.delete(user.id)
      const leaveEventData: PartyLeaveEvent = {
        type: 'leave',
        user,
      }
      this.publishToParty(party.id, leaveEventData)
    }

    // TODO(2Pac): Handle party leader leaving

    // If the last person in a party leaves, the party is removed. All outstanding invites to this,
    // now non-existing party, should fail.
    if (party.members.size < 1) {
      this.parties.delete(party.id)
    }
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
