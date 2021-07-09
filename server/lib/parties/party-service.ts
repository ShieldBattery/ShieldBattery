import cuid from 'cuid'
import { inject, singleton } from 'tsyringe'
import { NotificationType } from '../../../common/notifications'
import {
  MAX_PARTY_SIZE,
  PartyEvent,
  PartyInitEvent,
  PartyPayload,
  PartyUser,
} from '../../../common/parties'
import logger from '../logging/logger'
import filterChatMessage from '../messaging/filter-chat-message'
import NotificationService from '../notifications/notification-service'
import { ClientSocketsGroup, ClientSocketsManager } from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'

export interface PartyRecord {
  id: string
  invites: Map<number, PartyUser>
  members: Map<number, PartyUser>
  leader: PartyUser
}

export enum PartyServiceErrorCode {
  NotFoundOrNotInvited,
  NotFoundOrNotInParty,
  InsufficientPermissions,
  PartyFull,
  UserOffline,
  InvalidAction,
  NotificationFailure,
}

export class PartyServiceError extends Error {
  constructor(readonly code: PartyServiceErrorCode, message: string) {
    super(message)
  }
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
  /**
   * Maps party ID -> record representing that party. Party is created as soon as someone is invited
   * and removed once the last person in a party leaves.
   */
  private parties = new Map<string, PartyRecord>()
  /** Maps client sockets group -> party ID. Only one client sockets group can be in a party. */
  private clientSocketsToPartyId = new Map<ClientSocketsGroup, string>()

  constructor(
    private publisher: TypedPublisher<PartyEvent>,
    private clientSocketsManager: ClientSocketsManager,
    private notificationService: NotificationService,
    @inject('getCurrentTime') private getCurrentTime: () => number,
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
      this.publisher.publish(getPartyPath(party.id), {
        type: 'invite',
        invitedUser,
        time: this.getCurrentTime(),
        userInfo: {
          id: invitedUser.id,
          name: invitedUser.name,
        },
      })
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

    try {
      await this.notificationService.addNotification({
        userId: invitedUser.id,
        data: {
          type: NotificationType.PartyInvite,
          from: leader.name,
          partyId: party.id,
        },
      })
    } catch (err) {
      // The invite doesn't make much sense unless the notification has been successfully sent to
      // the user, so in case of an error, we remove the invited user from the party.
      party!.invites.delete(invitedUser.id)

      throw new PartyServiceError(
        PartyServiceErrorCode.NotificationFailure,
        'Error creating the notification',
      )
    }

    return party
  }

  decline(partyId: string, target: PartyUser) {
    this.clearInviteNotification(partyId, target)

    const party = this.parties.get(partyId)
    if (!party || !party.invites.has(target.id)) {
      throw new PartyServiceError(
        PartyServiceErrorCode.NotFoundOrNotInvited,
        "Party not found or you're not invited to it",
      )
    }

    party.invites.delete(target.id)
    this.publisher.publish(getPartyPath(party.id), {
      type: 'decline',
      target,
      time: this.getCurrentTime(),
    })
  }

  removeInvite(partyId: string, removingUser: PartyUser, target: PartyUser) {
    this.clearInviteNotification(partyId, target)

    const party = this.parties.get(partyId)
    if (!party || !party.members.has(removingUser.id)) {
      throw new PartyServiceError(
        PartyServiceErrorCode.NotFoundOrNotInParty,
        "Party not found or you're not in it",
      )
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
    this.publisher.publish(getPartyPath(party.id), {
      type: 'uninvite',
      target,
      time: this.getCurrentTime(),
    })
  }

  acceptInvite(partyId: string, user: PartyUser, clientId: string) {
    this.clearInviteNotification(partyId, user)

    const party = this.parties.get(partyId)
    if (!party || !party.invites.has(user.id)) {
      throw new PartyServiceError(
        PartyServiceErrorCode.NotFoundOrNotInvited,
        "Party not found or you're not invited to it",
      )
    }

    if (party.members.size >= MAX_PARTY_SIZE) {
      throw new PartyServiceError(PartyServiceErrorCode.PartyFull, 'Party is full')
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

    this.publisher.publish(getPartyPath(party.id), {
      type: 'join',
      user,
      time: this.getCurrentTime(),
    })
    this.subscribeToParty(clientSockets, party)
  }

  leaveParty(partyId: string, userId: number, clientId: string) {
    const party = this.parties.get(partyId)
    if (!party || !party.members.has(userId)) {
      throw new PartyServiceError(
        PartyServiceErrorCode.NotFoundOrNotInParty,
        "Party not found or you're not in it",
      )
    }

    const clientSockets = this.getClientSockets(userId, clientId)
    this.removeClientFromParty(clientSockets, party)
  }

  sendChatMessage(partyId: string, userId: number, message: string) {
    const party = this.parties.get(partyId)
    if (!party || !party.members.has(userId)) {
      throw new PartyServiceError(
        PartyServiceErrorCode.NotFoundOrNotInParty,
        "Party not found or you're not in it",
      )
    }

    const user = party.members.get(userId)!
    const text = filterChatMessage(message)

    this.publisher.publish(getPartyPath(partyId), {
      type: 'chatMessage',
      from: user,
      time: this.getCurrentTime(),
      text,
    })
  }

  private clearInviteNotification(partyId: string, user: PartyUser) {
    this.notificationService
      .retrieveNotifications({ userId: user.id, type: NotificationType.PartyInvite })
      .then(async userInviteNotifications => {
        const notification = userInviteNotifications.filter(n => n.data.partyId === partyId)[0]
        if (notification) {
          await this.notificationService.clearById(user.id, notification.id)
        }
      })
      .catch(err => {
        logger.error({ err }, 'error clearing the invite notification')
      })
  }

  private subscribeToParty(clientSockets: ClientSocketsGroup, party: PartyRecord) {
    clientSockets.subscribe<PartyInitEvent>(
      getPartyPath(party.id),
      () => ({
        type: 'init',
        party: toPartyJson(party),
        time: this.getCurrentTime(),
        userInfos: [
          ...Array.from(party.invites.values()),
          ...Array.from(party.members.values()),
        ].map(u => ({
          id: u.id,
          name: u.name,
        })),
      }),
      sockets => this.removeClientFromParty(sockets),
    )
  }

  private removeClientFromParty(
    clientSockets: ClientSocketsGroup,
    party = this.getClientParty(clientSockets),
  ) {
    if (!party) {
      const err = new Error('Party not found')
      logger.error({ err }, 'error while handling client quitting')
      return
    }

    const user = party.members.get(clientSockets.userId)
    if (user) {
      party.members.delete(user.id)
      this.publisher.publish(getPartyPath(party.id), {
        type: 'leave',
        user,
        time: this.getCurrentTime(),
      })
    }

    this.clientSocketsToPartyId.delete(clientSockets)
    clientSockets.unsubscribe(getPartyPath(party.id))

    // TODO(2Pac): Handle party leader leaving

    // If the last person in a party leaves, the party is removed. All outstanding invites to this,
    // now non-existing party, should fail.
    if (party.members.size < 1) {
      this.parties.delete(party.id)
    }
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
