import { Map as IMap, Set as ISet, OrderedSet } from 'immutable'
import { singleton } from 'tsyringe'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { SbChannelId } from '../../../common/chat'
import { subtract } from '../../../common/data-structures/sets'
import { RolledOutcome, RolledOutcomeRequest } from '../../../common/rolled-outcomes'
import { urlPath } from '../../../common/urls'
import { RestrictionKind } from '../../../common/users/restrictions'
import { SbUser } from '../../../common/users/sb-user'
import { SbUserId } from '../../../common/users/sb-user-id'
import {
  GetSessionHistoryResponse,
  GetWhisperMessageLinkResponse,
  GetWhisperSessionsResponse,
  WhisperEvent,
  WhisperMessage,
  WhisperMessageType,
  WhisperServiceErrorCode,
  WhisperSessionInitEvent,
  WhisperUserEvent,
} from '../../../common/whispers'
import {
  FullChannelInfo,
  getChannelInfos,
  HistoryCursor,
  toBasicChannelInfo,
} from '../chat/chat-models'
import logger from '../logging/logger'
import { emoteField } from '../messaging/emote-field'
import filterChatMessage from '../messaging/filter-chat-message'
import { outcomeField } from '../messaging/outcome-field'
import { processMessageContents } from '../messaging/process-chat-message'
import { rollOutcome } from '../messaging/roll-outcome'
import { RestrictionService } from '../users/restriction-service'
import { findUserById, findUsersById } from '../users/user-model'
import { UserSocketsGroup, UserSocketsManager } from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'
import {
  addMessageToWhisper,
  closeWhisperSession as dbCloseWhisperSession,
  startWhisperSession as dbStartWhisperSession,
  startWhisperSessionsBothDirections as dbStartWhisperSessionsBothDirections,
  getMessagesForWhisperSession,
  getUnreadWhisperTargets,
  getWhisperMessageParticipants,
  getWhisperMessageSentTime,
  getWhisperSessionsForUser,
  updateLastReadTime,
} from './whisper-models'

export class WhisperServiceError extends Error {
  constructor(
    readonly code: WhisperServiceErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export function getSessionPath(user: SbUserId, target: SbUserId) {
  const [low, high] = user < target ? [user, target] : [target, user]
  return urlPath`/whispers3/${low}-${high}`
}

/**
 * Path for events meant only for one user's own sessions, rather than for a conversation. Read
 * position updates must be published here rather than on `getSessionPath`, since the shared session
 * path is subscribed to by both participants and the other participant must not see this user's
 * read position.
 */
export function getWhisperUserPath(userId: SbUserId) {
  return urlPath`/whispers3/users/${userId}`
}

@singleton()
export default class WhisperService {
  /** Maps user ID -> OrderedSet of their whisper sessions (as IDs of target users) */
  private userSessions = IMap<SbUserId, OrderedSet<SbUserId>>()
  /** Maps user ID -> Set of users that have session open with them (as IDs) */
  private sessionUsers = IMap<SbUserId, ISet<SbUserId>>()

  constructor(
    private publisher: TypedPublisher<WhisperEvent | WhisperUserEvent>,
    private userSocketsManager: UserSocketsManager,
    private restrictionService: RestrictionService,
  ) {
    userSocketsManager
      .on('newUser', userSockets => {
        this.handleNewUser(userSockets).catch(err =>
          logger.error({ err }, 'Error handling new user in whisper service'),
        )
      })
      .on('userQuit', userId => this.handleUserQuit(userId))
  }

  async getWhisperSessions(userId: SbUserId): Promise<GetWhisperSessionsResponse> {
    const [sessionEntries, unreadSessions] = await Promise.all([
      getWhisperSessionsForUser(userId),
      getUnreadWhisperTargets(userId),
    ])
    const sessions = sessionEntries.map(s => s.targetId)
    // The whisper unread query counts messages `sent >= start_date` when no read position has been
    // recorded, so a session without one still gets a marker here, one millisecond before its start.
    const lastReadTimes = sessionEntries.map(s => ({
      targetId: s.targetId,
      lastReadTime: s.lastReadTime?.getTime() ?? s.startDate.getTime() - 1,
    }))
    const users = await findUsersById(sessions)
    return {
      sessions,
      users,
      unreadSessions,
      lastReadTimes,
    }
  }

  /**
   * Records the newest message time a user has seen in a whisper conversation, and publishes the
   * resulting read position to all of that user's connected sessions (so a mark-read made in one
   * session updates the unread badges and read positions of their others). A no-op if the session
   * doesn't exist (e.g. it was closed, or never opened).
   */
  async markRead(userId: SbUserId, targetId: SbUserId, lastReadTime: Date): Promise<void> {
    const stored = await updateLastReadTime(userId, targetId, lastReadTime)
    if (stored !== undefined) {
      this.publisher.publish(getWhisperUserPath(userId), {
        action: 'lastReadTimeChanged',
        target: targetId,
        lastReadTime: stored.getTime(),
      })
    }
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
    this.userSessions = this.userSessions.update(userId, s => s?.delete(targetUser))

    if (this.sessionUsers.has(targetUser)) {
      const updated = this.sessionUsers.get(targetUser)!.delete(userId)
      this.sessionUsers = updated.size
        ? this.sessionUsers.set(targetUser, updated)
        : this.sessionUsers.delete(targetUser)
    }

    this.publisher.publish(getSessionPath(userId, targetUser), {
      action: 'closeSession',
      target: targetUser,
    })
    this.unsubscribeUserFromWhisperSession(userId, targetUser)

    return true
  }

  async sendWhisperMessage(
    userId: SbUserId,
    targetUser: SbUserId,
    message: string,
    options: { emote?: boolean } = {},
  ) {
    const [user, target] = await this.ensureCanWhisper(userId, targetUser)

    const text = filterChatMessage(message)
    const [processedText, userMentions, channelMentions] = await processMessageContents(text)

    await this.storeAndPublishTextMessage({
      user,
      target,
      text: processedText,
      userMentions,
      channelMentions,
      emote: options.emote,
    })
  }

  /**
   * Settles an outcome (a roll, a coin flip, an 8-ball answer, a unit quote) for a user and
   * announces it in their conversation with another user as an action line.
   *
   * The line's wording is the client's to compose from the outcome, so the message's text carries
   * only the words the user typed themselves: the question put to the 8-ball, and nothing at all
   * for any other kind. Those words are never mention-processed, since an announcement the server
   * wrote must not become a way to make it notify people.
   */
  async sendOutcome(userId: SbUserId, targetUser: SbUserId, request: RolledOutcomeRequest) {
    const [user, target] = await this.ensureCanWhisper(userId, targetUser)

    await this.storeAndPublishTextMessage({
      user,
      target,
      text: request.kind === 'eightBall' ? filterChatMessage(request.question) : '',
      userMentions: [],
      channelMentions: [],
      emote: true,
      outcome: rollOutcome(request),
    })
  }

  /**
   * Throws unless the user is allowed to whisper the target right now, returning both of their user
   * infos. Nobody whispers themselves, and a chat-restricted user whispers no one.
   */
  private async ensureCanWhisper(
    userId: SbUserId,
    targetUser: SbUserId,
  ): Promise<[user: SbUser, target: SbUser]> {
    if (userId === targetUser) {
      throw new WhisperServiceError(
        WhisperServiceErrorCode.NoSelfMessaging,
        "Can't whisper with yourself",
      )
    }

    const isChatRestricted = await this.restrictionService.isRestricted(
      userId,
      RestrictionKind.Chat,
    )
    if (isChatRestricted) {
      throw new WhisperServiceError(
        WhisperServiceErrorCode.UserChatRestricted,
        'User is chat restricted',
      )
    }

    return await Promise.all([this.getUserById(userId), this.getUserById(targetUser)])
  }

  /**
   * Stores a text message in a whisper conversation and hands it to both participants, starting the
   * conversation for either of them who was not in it yet.
   */
  private async storeAndPublishTextMessage({
    user,
    target,
    text,
    userMentions,
    channelMentions,
    emote,
    outcome,
  }: {
    user: SbUser
    target: SbUser
    text: string
    userMentions: SbUser[]
    channelMentions: FullChannelInfo[]
    emote?: boolean
    outcome?: RolledOutcome
  }): Promise<void> {
    const mentionedUserIds = userMentions.map(u => u.id)
    const mentionedChannelIds = channelMentions.map(c => c.id)

    // Both session rows must exist before the message does: a session with no recorded read
    // position counts messages from `start_date` on as unread (see `getUnreadWhisperTargets`), so
    // a `start_date` that postdates the conversation's first message would hide that message from
    // the recipient's unread state.
    // TODO(tec27): This makes the start throttle rather useless, doesn't it? Think of a better way
    // to throttle people starting tons of tons of sessions with different people
    await dbStartWhisperSessionsBothDirections(user.id, target.id)

    const result = await addMessageToWhisper(user.id, target.id, {
      type: WhisperMessageType.TextMessage,
      text,
      mentions: mentionedUserIds.length > 0 ? mentionedUserIds : undefined,
      channelMentions: mentionedChannelIds.length > 0 ? mentionedChannelIds : undefined,
      ...emoteField(emote),
      ...outcomeField(outcome),
    })
    this.applyWhisperSessionState(user, target)
    this.applyWhisperSessionState(target, user)

    this.publisher.publish(getSessionPath(user.id, target.id), {
      action: 'message',
      message: {
        id: result.id,
        type: result.data.type,
        from: result.from,
        to: result.to,
        time: Number(result.sent),
        text: result.data.text,
        ...emoteField(result.data.emote),
        ...outcomeField(result.data.outcome),
      },
      users: [user, target],
      mentions: userMentions,
      channelMentions: channelMentions.map(c => toBasicChannelInfo(c)),
    })
  }

  async getSessionHistory(
    userId: SbUserId,
    targetUser: SbUserId,
    limit?: number,
    beforeTime?: number,
    afterTime?: number,
    aroundTime?: number,
    aroundMessageId?: string,
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

    // Joi's `.oxor` guarantees at most one of these is present on the request.
    let cursor: HistoryCursor = { kind: 'newest' }
    if (beforeTime && beforeTime > -1) {
      cursor = { kind: 'before', date: new Date(beforeTime) }
    } else if (afterTime !== undefined && afterTime >= 0) {
      cursor = { kind: 'after', date: new Date(afterTime) }
    } else if (aroundTime !== undefined && aroundTime >= 0) {
      cursor = { kind: 'around', date: new Date(aroundTime) }
    } else if (aroundMessageId !== undefined) {
      const sentTime = await getWhisperMessageSentTime(user.id, target.id, aroundMessageId)
      if (sentTime === undefined) {
        throw new WhisperServiceError(
          WhisperServiceErrorCode.MessageNotFound,
          'Message not found in this whisper',
        )
      }
      cursor = { kind: 'around', date: sentTime }
    }

    const {
      messages: dbMessages,
      hasMoreBefore,
      hasMoreAfter,
    } = await getMessagesForWhisperSession(user.id, target.id, limit, cursor)

    const messages: WhisperMessage[] = []
    const userMentionIds = new Set<SbUserId>()
    const channelMentionIds = new Set<SbChannelId>()

    for (const msg of dbMessages) {
      switch (msg.data.type) {
        case WhisperMessageType.TextMessage:
          messages.push({
            id: msg.id,
            type: msg.data.type,
            from: msg.from,
            to: msg.to,
            time: Number(msg.sent),
            text: msg.data.text,
            ...emoteField(msg.data.emote),
            ...outcomeField(msg.data.outcome),
          })
          for (const mention of msg.data.mentions ?? []) {
            userMentionIds.add(mention)
          }
          for (const mention of msg.data.channelMentions ?? []) {
            channelMentionIds.add(mention)
          }
          break

        default:
          return assertUnreachable(msg.data.type)
      }
    }

    const [userMentions, channelMentions] = await Promise.all([
      findUsersById(Array.from(userMentionIds)),
      getChannelInfos(Array.from(channelMentionIds)),
    ])

    const deletedChannels =
      channelMentionIds.size === channelMentions.length
        ? []
        : Array.from(
            subtract(
              channelMentionIds,
              channelMentions.map(c => c.id),
            ),
          )

    return {
      messages,
      users: [user, target],
      mentions: userMentions,
      channelMentions: channelMentions.map(c => toBasicChannelInfo(c)),
      deletedChannels,
      hasMoreBefore,
      hasMoreAfter,
    }
  }

  /**
   * Resolves a whisper message link for `userId`: which conversation the message belongs to, from
   * their side. Throws `MessageNotFound` both when the message doesn't exist at all and when
   * `userId` isn't one of its two participants -- the two cases are indistinguishable to the
   * caller, so someone probing message ids they weren't sent learns nothing about which case
   * applies. A participant whose session with the target is currently closed still resolves: the
   * whisper page reopens the session on visit, the same as navigating there directly would.
   */
  async getMessageLinkTarget(
    userId: SbUserId,
    messageId: string,
  ): Promise<GetWhisperMessageLinkResponse> {
    const participants = await getWhisperMessageParticipants(messageId)
    if (!participants || (participants.from !== userId && participants.to !== userId)) {
      throw new WhisperServiceError(
        WhisperServiceErrorCode.MessageNotFound,
        'Message not found in this whisper',
      )
    }

    const targetId = participants.from === userId ? participants.to : participants.from
    const target = await this.getUserById(targetId)

    return { targetId, users: [target] }
  }

  async getUserById(id: SbUserId): Promise<SbUser> {
    const foundUser = await findUserById(id)
    if (!foundUser) {
      throw new WhisperServiceError(WhisperServiceErrorCode.UserNotFound, 'User not found')
    }

    return foundUser
  }

  unsubscribeUserFromWhisperSession(userId: SbUserId, targetUser: SbUserId) {
    const userSockets = this.userSocketsManager.getById(userId)
    userSockets?.unsubscribe(getSessionPath(userId, targetUser))
  }

  private async ensureWhisperSession(user: SbUser, target: SbUser) {
    await dbStartWhisperSession(user.id, target.id)
    this.applyWhisperSessionState(user, target)
  }

  /**
   * Updates the in-memory session bookkeeping (and subscribes the user's sockets, if any) to
   * reflect that `user` has a whisper session open with `target`. Assumes the corresponding DB row
   * already exists.
   */
  private applyWhisperSessionState(user: SbUser, target: SbUser) {
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
      userSockets.subscribe<WhisperSessionInitEvent>(
        getSessionPath(userSockets.userId, target.id),
        () => ({
          action: 'initSession3',
          target: target.id,
        }),
      )
    }
  }

  private async handleNewUser(userSockets: UserSocketsGroup) {
    // Subscribed before the awaited DB fetch below so an update published to this user's own path
    // while that fetch is in flight isn't missed.
    userSockets.subscribe(getWhisperUserPath(userSockets.userId))

    const whisperSessionEntries = await getWhisperSessionsForUser(userSockets.userId)
    if (!userSockets.sockets.size) {
      // The user disconnected while we were waiting for their whisper sessions
      return
    }

    const whisperSessionIds = whisperSessionEntries.map(s => s.targetId)
    const targetIdsSet = OrderedSet(whisperSessionIds)
    this.userSessions = this.userSessions.set(userSockets.userId, targetIdsSet)
    for (const id of whisperSessionIds) {
      // Add the new user to all of the sessions they have opened
      this.sessionUsers = this.sessionUsers.update(id, ISet(), s => s.add(userSockets.userId))
      userSockets.subscribe(getSessionPath(userSockets.userId, id))
    }
  }

  /**
   * Drops the in-memory session bookkeeping for a user whose last socket closed. This runs
   * synchronously in the quit event: the user can reconnect right after quitting, and
   * `handleNewUser` for that connection repopulates the same entries, so a deferred delete here
   * would land after them and leave a connected user with no sessions until their next reconnect.
   */
  private handleUserQuit(userId: SbUserId) {
    if (!this.userSessions.has(userId)) {
      // This can happen if a user disconnects before we get their whisper sessions back from the DB
      return
    }

    // Delete the user that quit from all of the sessions they had opened, if any
    for (const target of this.userSessions.get(userId)!.values()) {
      const updated = this.sessionUsers.get(target)?.delete(userId)
      this.sessionUsers = updated?.size
        ? this.sessionUsers.set(target, updated)
        : this.sessionUsers.delete(target)
    }
    this.userSessions = this.userSessions.delete(userId)
  }
}
