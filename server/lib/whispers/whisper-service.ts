import { Map as IMap, OrderedSet, Set as ISet } from 'immutable'
import { singleton } from 'tsyringe'
import { urlPath } from '../../../common/urls'
import { SbUser, SbUserId } from '../../../common/users/sb-user'
import {
  GetSessionHistoryResponse,
  WhisperEvent,
  WhisperMessage,
  WhisperMessageType,
  WhisperServiceErrorCode,
  WhisperSessionInitEvent,
} from '../../../common/whispers'
import logger from '../logging/logger'
import filterChatMessage from '../messaging/filter-chat-message'
import { processMessageContents } from '../messaging/process-chat-message'
import { findUserById, findUsersById } from '../users/user-model'
import { UserSocketsGroup, UserSocketsManager } from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'
import {
  addMessageToWhisper,
  closeWhisperSession as dbCloseWhisperSession,
  getMessagesForWhisperSession,
  getWhisperSessionsForUser,
  startWhisperSession as dbStartWhisperSession,
} from './whisper-models'

export class WhisperServiceError extends Error {
  constructor(readonly code: WhisperServiceErrorCode, message: string) {
    super(message)
  }
}

export function getSessionPath(user: SbUserId, target: SbUserId) {
  const [low, high] = user < target ? [user, target] : [target, user]
  return urlPath`/whispers3/${low}-${high}`
}

@singleton()
export default class WhisperService {
  /** Maps user ID -> OrderedSet of their whisper sessions (as IDs of target users) */
  private userSessions = IMap<SbUserId, OrderedSet<SbUserId>>()
  /** Maps user ID -> Set of users that have session open with them (as IDs) */
  private sessionUsers = IMap<SbUserId, ISet<SbUserId>>()

  constructor(
    private publisher: TypedPublisher<WhisperEvent>,
    private userSocketsManager: UserSocketsManager,
  ) {
    userSocketsManager
      .on('newUser', userSockets =>
        this.handleNewUser(userSockets).catch(err =>
          logger.error({ err }, 'Error handling new user in whisper service'),
        ),
      )
      .on('userQuit', userId =>
        this.handleUserQuit(userId).catch(err =>
          logger.error({ err }, 'Error handling user disconnect in whisper service'),
        ),
      )
  }

  async startWhisperSession(userId: SbUserId, targetUser: SbUserId) {
    if (userId === targetUser) {
      throw new WhisperServiceError(
        WhisperServiceErrorCode.NoSelfMessaging,
        "Can't whisper with yourself",
      )
    }

    const [user, target] = await Promise.all([
      this.getUserById(userId),
      this.getUserById(targetUser),
    ])

    await this.ensureWhisperSession(user, target)
  }

  async closeWhisperSession(userId: SbUserId, targetUser: SbUserId): Promise<boolean> {
    if (!this.userSessions.get(userId)?.has(targetUser)) {
      return false
    }

    await dbCloseWhisperSession(userId, targetUser)
    this.userSessions = this.userSessions.update(userId, s => s!.delete(targetUser))

    const updated = this.sessionUsers.get(targetUser)!.delete(userId)
    this.sessionUsers = updated.size
      ? this.sessionUsers.set(targetUser, updated)
      : this.sessionUsers.delete(targetUser)

    this.publisher.publish(getSessionPath(userId, targetUser), {
      action: 'closeSession',
      target: targetUser,
    })
    this.unsubscribeUserFromWhisperSession(userId, targetUser)

    return true
  }

  async sendWhisperMessage(userId: SbUserId, targetUser: SbUserId, message: string) {
    if (userId === targetUser) {
      throw new WhisperServiceError(
        WhisperServiceErrorCode.NoSelfMessaging,
        "Can't whisper with yourself",
      )
    }

    const [user, target] = await Promise.all([
      this.getUserById(userId),
      this.getUserById(targetUser),
    ])

    const text = filterChatMessage(message)
    const [processedText, mentionedUsers] = await processMessageContents(text)
    const mentions = Array.from(mentionedUsers.values())
    const result = await addMessageToWhisper(user.id, target.id, {
      type: WhisperMessageType.TextMessage,
      text: processedText,
      mentions: mentions.map(m => m.id),
    })

    // TODO(tec27): This makes the start throttle rather useless, doesn't it? Think of a better way
    // to throttle people starting tons of tons of sessions with different people
    await Promise.all([
      this.ensureWhisperSession(user, target),
      this.ensureWhisperSession(target, user),
    ])

    this.publisher.publish(getSessionPath(userId, targetUser), {
      action: 'message',
      message: {
        id: result.id,
        from: result.from,
        to: result.to,
        sent: Number(result.sent),
        data: result.data,
      },
      users: [user, target],
      mentions,
    })
  }

  async getSessionHistory(
    userId: SbUserId,
    targetUser: SbUserId,
    limit?: number,
    beforeTime?: number,
  ): Promise<GetSessionHistoryResponse> {
    const [user, target] = await Promise.all([
      this.getUserById(userId),
      this.getUserById(targetUser),
    ])

    if (!this.userSessions.get(user.id)?.has(target.id)) {
      throw new WhisperServiceError(
        WhisperServiceErrorCode.InvalidGetSessionHistoryAction,
        'Must have a whisper session with this user to retrieve message history',
      )
    }

    const dbMessages = await getMessagesForWhisperSession(
      user.id,
      target.id,
      limit,
      beforeTime && beforeTime > -1 ? new Date(beforeTime) : undefined,
    )

    const messages: WhisperMessage[] = []
    const mentionIds = new Set<SbUserId>()

    for (const msg of dbMessages) {
      messages.push({
        id: msg.id,
        from: msg.from,
        to: msg.to,
        sent: Number(msg.sent),
        data: msg.data,
      })
      for (const mention of msg.data.mentions ?? []) {
        mentionIds.add(mention)
      }
    }

    const mentions = await findUsersById(Array.from(mentionIds))

    return {
      messages,
      users: [user, target],
      mentions,
    }
  }

  async getUserById(id: SbUserId): Promise<SbUser> {
    const foundUser = await findUserById(id)
    if (!foundUser) {
      throw new WhisperServiceError(WhisperServiceErrorCode.UserNotFound, 'User not found')
    }

    return foundUser
  }

  private subscribeUserToWhisperSession(userSockets: UserSocketsGroup, target: SbUser) {
    userSockets.subscribe<WhisperSessionInitEvent>(
      getSessionPath(userSockets.userId, target.id),
      () => ({
        action: 'initSession2',
        target,
      }),
    )
  }

  unsubscribeUserFromWhisperSession(userId: SbUserId, targetUser: SbUserId) {
    const userSockets = this.userSocketsManager.getById(userId)
    userSockets?.unsubscribe(getSessionPath(userId, targetUser))
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
    this.sessionUsers = this.sessionUsers.update(target.id, ISet(), s => s.add(user.id))

    if (!this.userSessions.get(user.id)?.has(target.id)) {
      this.userSessions = this.userSessions.update(user.id, OrderedSet(), s => s.add(target.id))
      this.subscribeUserToWhisperSession(userSockets, target)
    }
  }

  private async handleNewUser(userSockets: UserSocketsGroup) {
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
      this.sessionUsers = this.sessionUsers.update(session.targetId, ISet(), s =>
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
