import { Map, OrderedSet, Set } from 'immutable'
import { singleton } from 'tsyringe'
import { SbUser, SbUserId } from '../../../common/users/user-info'
import {
  GetSessionHistoryServerPayload,
  WhisperEvent,
  WhisperMessage,
  WhisperMessageType,
  WhisperSessionInitEvent,
  WhisperUserStatus,
} from '../../../common/whispers'
import filterChatMessage from '../messaging/filter-chat-message'
import { parseChatMessage } from '../messaging/parse-chat-message'
import { findUserById, findUserByName, findUsersById } from '../users/user-model'
import { UserSocketsGroup, UserSocketsManager } from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'
import {
  addMessageToWhisper,
  closeWhisperSession as dbCloseWhisperSession,
  getMessagesForWhisperSession,
  getWhisperSessionsForUser,
  startWhisperSession as dbStartWhisperSession,
} from './whisper-models'

export enum WhisperServiceErrorCode {
  UserOffline,
  UserNotFound,
  NoSelfMessaging,
  InvalidCloseAction,
  InvalidGetSessionHistoryAction,
}

export class WhisperServiceError extends Error {
  constructor(readonly code: WhisperServiceErrorCode, message: string) {
    super(message)
  }
}

export function getSessionPath(user: string, target: string) {
  const users = [user, target].sort()
  return `/whispers2/${encodeURIComponent(users[0] + '|' + users[1])}`
}

@singleton()
export default class WhisperService {
  /** Maps user ID -> OrderedSet of their whisper sessions (as IDs of target users) */
  private userSessions = Map<SbUserId, OrderedSet<SbUserId>>()
  /** Maps user ID -> Set of users that have session open with them (as IDs) */
  private sessionUsers = Map<SbUserId, Set<SbUserId>>()

  constructor(
    private publisher: TypedPublisher<WhisperEvent>,
    private userSocketsManager: UserSocketsManager,
  ) {
    userSocketsManager
      .on('newUser', userSockets => this.handleNewUser(userSockets))
      .on('userQuit', userId => this.handleUserQuit(userId))
  }

  async startWhisperSession(userId: SbUserId, targetName: string) {
    const [user, target] = await Promise.all([
      this.getUserById(userId),
      this.getUserByName(targetName),
    ])

    if (user.id === target.id) {
      throw new WhisperServiceError(
        WhisperServiceErrorCode.NoSelfMessaging,
        "Can't whisper with yourself",
      )
    }

    await this.ensureWhisperSession(user, target)
  }

  async closeWhisperSession(userId: SbUserId, targetName: string) {
    const [user, target] = await Promise.all([
      this.getUserById(userId),
      this.getUserByName(targetName),
    ])

    if (!this.userSessions.get(user.id)?.has(target.id)) {
      throw new WhisperServiceError(
        WhisperServiceErrorCode.InvalidCloseAction,
        'No whisper session with this user',
      )
    }

    await dbCloseWhisperSession(user.id, target.id)
    this.userSessions = this.userSessions.update(user.id, s => s!.delete(target.id))

    const updated = this.sessionUsers.get(target.id)!.delete(user.id)
    this.sessionUsers = updated.size
      ? this.sessionUsers.set(target.id, updated)
      : this.sessionUsers.delete(target.id)

    this.publisher.publish(getSessionPath(user.name, target.name), {
      action: 'closeSession',
      target,
    })
    this.unsubscribeUserFromWhisperSession(user.id, target.name)
  }

  async sendWhisperMessage(userId: SbUserId, targetName: string, message: string) {
    const [user, target] = await Promise.all([
      this.getUserById(userId),
      this.getUserByName(targetName),
    ])

    if (user.id === target.id) {
      throw new WhisperServiceError(
        WhisperServiceErrorCode.NoSelfMessaging,
        "Can't whisper with yourself",
      )
    }

    const text = filterChatMessage(message)
    const [parsedText, mentionedUsers] = await parseChatMessage(text)
    const mentions = Array.from(mentionedUsers.values())
    const result = await addMessageToWhisper(user.id, target.id, {
      type: WhisperMessageType.TextMessage,
      text: parsedText,
      mentions: mentions.map(m => m.id),
    })

    // TODO(tec27): This makes the start throttle rather useless, doesn't it? Think of a better way
    // to throttle people starting tons of tons of sessions with different people
    await Promise.all([
      this.ensureWhisperSession(user, target),
      this.ensureWhisperSession(target, user),
    ])

    this.publisher.publish(getSessionPath(user.name, targetName), {
      action: 'message',
      message: {
        id: result.id,
        from: result.from,
        to: result.to,
        sent: Number(result.sent),
        data: result.data,
      },
      users: [
        { id: user.id, name: user.name },
        { id: target.id, name: target.name },
      ],
      mentions,
    })
  }

  async getSessionHistory(
    userId: SbUserId,
    targetName: string,
    limit?: number,
    beforeTime?: number,
  ): Promise<GetSessionHistoryServerPayload> {
    const [user, target] = await Promise.all([
      this.getUserById(userId),
      this.getUserByName(targetName),
    ])

    if (!this.userSessions.get(user.id)?.has(target.id)) {
      throw new WhisperServiceError(
        WhisperServiceErrorCode.InvalidGetSessionHistoryAction,
        'Must have a whisper session with this user to retrieve message history',
      )
    }

    const messages = await getMessagesForWhisperSession(
      user.id,
      target.id,
      limit,
      beforeTime && beforeTime > -1 ? new Date(beforeTime) : undefined,
    )
    const mentionIds = messages.reduce(
      (mentions, msg) => [...mentions, ...(msg.data.mentions ?? [])],
      [] as SbUserId[],
    )

    const mentions = await findUsersById(mentionIds)

    return {
      messages: messages.map<WhisperMessage>(m => ({
        id: m.id,
        from: m.from,
        to: m.to,
        sent: Number(m.sent),
        data: m.data,
      })),
      users: [
        { id: user.id, name: user.name },
        { id: target.id, name: target.name },
      ],
      mentions: Array.from(mentions.values()),
    }
  }

  private getUserSockets(userId: SbUserId): UserSocketsGroup {
    const userSockets = this.userSocketsManager.getById(userId)
    if (!userSockets) {
      throw new WhisperServiceError(WhisperServiceErrorCode.UserOffline, 'User is offline')
    }

    return userSockets
  }

  async getUserByName(name: string): Promise<SbUser> {
    const foundUser = await findUserByName(name)
    if (!foundUser) {
      throw new WhisperServiceError(WhisperServiceErrorCode.UserNotFound, 'User not found')
    }

    return foundUser
  }

  async getUserById(id: SbUserId): Promise<SbUser> {
    const foundUser = await findUserById(id)
    if (!foundUser) {
      throw new WhisperServiceError(WhisperServiceErrorCode.UserNotFound, 'User not found')
    }

    return foundUser
  }

  private getUserStatus(userId: SbUserId) {
    // TODO(2Pac): check if the user is idle as well
    const isUserOnline = this.userSocketsManager.getById(userId)
    return isUserOnline ? WhisperUserStatus.Active : WhisperUserStatus.Offline
  }

  private subscribeUserToWhisperSession(userSockets: UserSocketsGroup, target: SbUser) {
    userSockets.subscribe<WhisperSessionInitEvent>(
      getSessionPath(userSockets.name, target.name),
      () => ({
        action: 'initSession',
        target,
        targetStatus: this.getUserStatus(target.id),
      }),
    )
  }

  unsubscribeUserFromWhisperSession(userId: SbUserId, targetName: string) {
    const userSockets = this.getUserSockets(userId)
    userSockets.unsubscribe(getSessionPath(userSockets.name, targetName))
  }

  private async ensureWhisperSession(user: SbUser, target: SbUser) {
    await dbStartWhisperSession(user.id, target.id)

    const userSockets = this.userSocketsManager.getById(user.id)
    // If the user is offline, the rest of the code will be done once they connect
    if (!userSockets) {
      return
    }

    // Maintain a list of users for each whisper session, so we can publish events to everyone that
    // has a session opened with a particular user
    this.sessionUsers = this.sessionUsers.update(target.id, Set(), s => s.add(user.id))

    if (!this.userSessions.get(user.id)?.has(target.id)) {
      this.userSessions = this.userSessions.update(user.id, OrderedSet(), s => s.add(target.id))
      this.subscribeUserToWhisperSession(userSockets, target)
    }
  }

  private async handleNewUser(userSockets: UserSocketsGroup) {
    // Publish 'userActive' event to all users that have a session opened with the new user, if any
    if (this.sessionUsers.has(userSockets.userId)) {
      for (const u of this.sessionUsers.get(userSockets.userId)!.values()) {
        const target = await this.getUserById(u)
        this.publisher.publish(getSessionPath(userSockets.name, target.name), {
          action: 'userActive',
          target: {
            id: userSockets.userId,
            name: userSockets.name,
          },
        })
      }
    }

    const whisperSessions = await getWhisperSessionsForUser(userSockets.userId)
    if (!userSockets.sockets.size) {
      // The user disconnected while we were waiting for their whisper sessions
      return
    }

    this.userSessions = this.userSessions.set(
      userSockets.userId,
      OrderedSet(whisperSessions.map(s => s.targetId)),
    )
    for (const session of whisperSessions) {
      // Add the new user to all of the sessions they have opened
      this.sessionUsers = this.sessionUsers.update(session.targetId, Set(), s =>
        s.add(userSockets.userId),
      )
      this.subscribeUserToWhisperSession(userSockets, {
        id: session.targetId,
        name: session.targetName,
      })
    }

    userSockets.subscribe(`${userSockets.getPath()}/whispers`, () => ({ type: 'whispersReady' }))
  }

  private async handleUserQuit(userId: SbUserId) {
    const user = await this.getUserById(userId)

    // Publish 'userOffline' event to all users that have a session opened with this user, if any
    if (this.sessionUsers.has(user.id)) {
      for (const u of this.sessionUsers.get(user.id)!.values()) {
        const target = await this.getUserById(u)
        this.publisher.publish(getSessionPath(user.name, target.name), {
          action: 'userOffline',
          target: user,
        })
      }
    }

    if (!this.userSessions.has(user.id)) {
      // This can happen if a user disconnects before we get their whisper sessions back from the DB
      return
    }

    // Delete the user that quit from all of the sessions they had opened, if any
    for (const target of this.userSessions.get(user.id)!.values()) {
      const updated = this.sessionUsers.get(target)?.delete(user.id)
      this.sessionUsers = updated?.size
        ? this.sessionUsers.set(target, updated)
        : this.sessionUsers.delete(target)
    }
    this.userSessions = this.userSessions.delete(user.id)
  }
}
