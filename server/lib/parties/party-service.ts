import cuid from 'cuid'
import { NydusServer } from 'nydus'
import { singleton } from 'tsyringe'
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
  PartyUninviteEvent,
  PartyUser,
} from '../../../common/parties'
import logger from '../logging/logger'
import NotificationService from '../notifications/notification-service'
import {
  ClientSocketsGroup,
  ClientSocketsManager,
  UserSocketsManager,
} from '../websockets/socket-groups'

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
  NotificationFail,
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
    private notificationService: NotificationService,
  ) {}

  async invite(
    leader: PartyUser,
    leaderClientId: string,
    invitedUser: PartyUser,
  ): Promise<PartyRecord> {
    const leaderClientSockets = this.getClientSockets(leader.id, leaderClientId)

    if (invitedUser.id === leader.id) {
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

      if (party.invites.has(invitedUser.id)) {
        throw new PartyServiceError(
          PartyServiceErrorCode.InvalidAction,
          'An invite already exists for this user',
        )
      }

      if (party.members.has(invitedUser.id)) {
        throw new PartyServiceError(
          PartyServiceErrorCode.InvalidAction,
          'This user is already a member of this party',
        )
      }

      party.invites.set(invitedUser.id, invitedUser)
      const inviteEventData: PartyInviteEvent = {
        type: 'invite',
        invitedUser,
      }
      this.publishToParty(party.id, inviteEventData)
    } else {
      const partyId = cuid()
      party = {
        id: partyId,
        invites: new Map([[invitedUser.id, invitedUser]]),
        members: new Map([[leader.id, leader]]),
        leader,
      }

      this.parties.set(partyId, party)
      this.clientSocketsToPartyId.set(leaderClientSockets, partyId)
      this.subscribeToParty(leaderClientSockets, party)
    }

    // The invite doesn't make much sense unless the notification has been successfully sent to
    // the user, so we only create an invite if that happens.
    try {
      await this.notificationService.addNotification({
        userId: invitedUser.id,
        data: {
          type: NotificationType.PartyInvite,
          from: leader.name,
          partyId: party.id,
        },
      })

      const userSockets = this.userSocketsManager.getById(invitedUser.id)
      if (userSockets) {
        const addInviteEventData: PartyAddInviteEvent = {
          type: 'addInvite',
          from: leader,
        }
        userSockets.subscribe(
          getInvitesPath(party.id, invitedUser.id),
          () => addInviteEventData,
          () => {
            // TODO(2Pac): Handle user quitting; need to keep a map of user -> invites?
          },
        )
      }
    } catch (err) {
      party!.invites.delete(invitedUser.id)
      throw new PartyServiceError(
        PartyServiceErrorCode.NotificationFail,
        'Error creating the notification',
      )
    }

    return party
  }

  decline(partyId: string, target: PartyUser) {
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
  }

  removeInvite(partyId: string, removingUser: PartyUser, target: PartyUser) {
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

    const uninviteEventData: PartyUninviteEvent = {
      type: 'uninvite',
      target,
    }
    this.publishToParty(partyId, uninviteEventData)
  }

  acceptInvite(partyId: string, user: PartyUser, clientId: string) {
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

    const userSockets = this.userSocketsManager.getById(user.id)
    if (userSockets) {
      userSockets.unsubscribe(getInvitesPath(partyId, user.id))
    }

    this.notificationService
      .retrieveNotifications({ userId: user.id, type: NotificationType.PartyInvite })
      .then(
        userInviteNotifications => {
          const notification = userInviteNotifications.filter(n => n.data.partyId === partyId)[0]
          if (notification) {
            this.notificationService.clearById(user.id, notification.id).catch(err => {
              logger.error({ err }, 'error clearing notification')
            })
          }
        },
        err => {
          logger.error({ err }, 'error retrieving user notifications')
        },
      )
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
