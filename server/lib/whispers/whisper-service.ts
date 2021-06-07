import { Map, OrderedSet, Set } from 'immutable'
import { singleton } from 'tsyringe'
import filterChatMessage from '../messaging/filter-chat-message'
import users, { User } from '../models/users'
import {
  addMessageToWhisper,
  closeWhisperSession,
  getMessagesForWhisperSession,
  getWhisperSessionsForUser,
  startWhisperSession,
} from '../models/whispers'
import { UserSocketsGroup, UserSocketsManager } from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'

export enum WhisperServiceErrorCode {
  UserOffline,
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
  return `/whispers/${encodeURIComponent(users[0] + '|' + users[1])}`
}

@singleton()
export default class WhisperService {
  /** Maps user name -> OrderedSet of their whisper sessions (as names of target users) */
  private userSessions = Map<string, OrderedSet<string>>()
  /** Maps user name -> Set of users that have session open with them (as names) */
  private sessionUsers = Map<string, Set<string>>()

  constructor(
    // TODO(2Pac): Type the whisper publish events
    private publisher: TypedPublisher<any>,
    private userSocketsManager: UserSocketsManager,
  ) {
    userSocketsManager
      .on('newUser', userSockets => this.handleNewUser(userSockets))
      .on('userQuit', userId => this.handleUserQuit(userId))
  }

  startWhisperSession(user: UserSocketsGroup, target: User) {
    if (user.name.toLowerCase() === target.name.toLowerCase()) {
      throw new WhisperServiceError(
        WhisperServiceErrorCode.NoSelfMessaging,
        "Can't whisper with yourself",
      )
    }

    this.ensureWhisperSession(user.userId, target.id as number)
  }

  async closeWhisperSession(user: UserSocketsGroup, target: User) {
    if (!this.userSessions.get(user.name)?.has(target.name)) {
      throw new WhisperServiceError(
        WhisperServiceErrorCode.InvalidCloseAction,
        'No whisper session with this user',
      )
    }

    await closeWhisperSession(user.session.userId, target.name)
    this.userSessions = this.userSessions.update(user.name, s => s.delete(target.name))

    const updated = this.sessionUsers.get(target.name)!.delete(user.name)
    this.sessionUsers = updated.size
      ? this.sessionUsers.set(target.name, updated)
      : this.sessionUsers.delete(target.name)

    this.publisher.publish(getSessionPath(user.name, target.name), {
      action: 'closeSession',
      target: target.name,
    })
    this.unsubscribeUserFromWhisperSession(user, target)
  }

  async sendWhisperMessage(user: UserSocketsGroup, target: User, message: string) {
    if (user.name.toLowerCase() === target.name.toLowerCase()) {
      throw new WhisperServiceError(
        WhisperServiceErrorCode.NoSelfMessaging,
        "Can't whisper with yourself",
      )
    }

    const text = filterChatMessage(message)
    const result = await addMessageToWhisper(user.session.userId, target.name, {
      type: 'message',
      text,
    })

    // TODO(tec27): This makes the start throttle rather useless, doesn't it? Think of a better way
    // to throttle people starting tons of tons of sessions with different people
    await Promise.all([
      this.ensureWhisperSession(user.userId, target.id as number),
      this.ensureWhisperSession(target.id as number, user.userId),
    ])

    this.publisher.publish(getSessionPath(user.name, target.name), {
      id: result.msgId,
      action: 'message',
      from: result.from,
      to: result.to,
      sent: +result.sent,
      data: result.data,
    })
  }

  async getSessionHistory(
    user: UserSocketsGroup,
    target: User,
    limit?: number,
    beforeTime?: number,
    // TODO(2Pac): Type the return type of whisper message
  ): Promise<any[]> {
    if (!this.userSessions.get(user.name)?.has(target.name)) {
      throw new WhisperServiceError(
        WhisperServiceErrorCode.InvalidGetSessionHistoryAction,
        'Must have a whisper session with this user to retrieve message history',
      )
    }

    const messages = await getMessagesForWhisperSession(user.name, target.name, limit, beforeTime)
    return messages.map(m => ({
      id: m.msgId,
      from: m.from,
      to: m.to,
      sent: Number(m.sent),
      data: m.data,
    }))
  }

  private getUserSockets(userId: number): UserSocketsGroup {
    const userSockets = this.userSocketsManager.getById(userId)
    if (!userSockets) {
      throw new WhisperServiceError(WhisperServiceErrorCode.UserOffline, 'User is offline')
    }

    return userSockets
  }

  private getUserStatus(userId: number) {
    // TODO(2Pac): check if the user is idle as well
    const isUserOnline = this.userSocketsManager.getById(userId)
    return isUserOnline ? 'active' : 'offline'
  }

  private subscribeUserToWhisperSession(user: UserSocketsGroup, target: User) {
    user.subscribe(getSessionPath(user.name, target.name), () => ({
      action: 'initSession',
      target: target.name,
      targetStatus: this.getUserStatus(target.id as number),
    }))
  }

  unsubscribeUserFromWhisperSession(user: UserSocketsGroup, target: User) {
    user.unsubscribe(getSessionPath(user.name, target.name))
  }

  private async ensureWhisperSession(userId: number, targetId: number) {
    await startWhisperSession(userId, targetId)

    const userSockets = this.getUserSockets(userId)
    // If the user is offline, the rest of the code will be done once they connect
    if (!userSockets) {
      return
    }

    const [user, target] = await Promise.all([users.find(userId), users.find(targetId)])
    if (!user || !target) {
      return
    }

    // Maintain a list of users for each whisper session, so we can publish events to everyone that
    // has a session opened with a particular user
    this.sessionUsers = this.sessionUsers.update(target.name, Set(), s => s.add(user.name))

    if (!this.userSessions.get(user.name)?.has(target.name)) {
      this.userSessions = this.userSessions.update(user.name, OrderedSet(), s => s.add(target.name))
      this.subscribeUserToWhisperSession(userSockets, target)
    }
  }

  private async handleNewUser(user: UserSocketsGroup) {
    // Publish 'userActive' event to all users that have a session opened with the new user, if any
    if (this.sessionUsers.has(user.name)) {
      for (const u of this.sessionUsers.get(user.name)!.values()) {
        this.publisher.publish(getSessionPath(user.name, u), {
          action: 'userActive',
          target: user.name,
        })
      }
    }

    const whisperSessions = await getWhisperSessionsForUser(user.session.userId)
    if (!user.sockets.size) {
      // The user disconnected while we were waiting for their whisper sessions
      return
    }

    this.userSessions = this.userSessions.set(
      user.name,
      OrderedSet(whisperSessions.map(s => s.targetUserName)),
    )
    for (const session of whisperSessions) {
      // Add the new user to all of the sessions they have opened
      this.sessionUsers = this.sessionUsers.update(session.targetUserName, Set(), s =>
        s.add(user.name),
      )
      this.subscribeUserToWhisperSession(user, {
        id: session.targetUserId,
        name: session.targetUserName,
      } as User)
    }

    user.subscribe(`${user.getPath()}/whispers`, () => ({ type: 'whispersReady' }))
  }

  private async handleUserQuit(userId: number) {
    // TODO(2Pac): Remove this once internal whisper structures have been moved to use `userId`.
    const foundUser = await users.find(userId)
    if (!foundUser) {
      return
    }
    const { name: userName } = foundUser

    // Publish 'userOffline' event to all users that have a session opened with this user, if any
    if (this.sessionUsers.has(userName)) {
      for (const u of this.sessionUsers.get(userName)!.values()) {
        this.publisher.publish(getSessionPath(userName, u), {
          action: 'userOffline',
          target: userName,
        })
      }
    }

    if (!this.userSessions.has(userName)) {
      // This can happen if a user disconnects before we get their whisper sessions back from the DB
      return
    }

    // Delete the user that quit from all of the sessions they had opened, if any
    for (const target of this.userSessions.get(userName)!.values()) {
      const updated = this.sessionUsers.get(target)?.delete(userName)
      this.sessionUsers = updated?.size
        ? this.sessionUsers.set(target, updated)
        : this.sessionUsers.delete(target)
    }
    this.userSessions = this.userSessions.delete(userName)
  }
}
