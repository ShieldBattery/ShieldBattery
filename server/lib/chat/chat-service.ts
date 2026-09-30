import formidable from 'formidable'
import { Record as ImmutableRecord, Map, Set } from 'immutable'
import mime from 'mime'
import { singleton } from 'tsyringe'
import { assertUnreachable } from '../../../common/assert-unreachable'
import swallowNonBuiltins from '../../../common/async/swallow-non-builtins'
import {
  BasicChannelInfo,
  CHANNEL_BADGE_HEIGHT,
  CHANNEL_BADGE_WIDTH,
  CHANNEL_BANNER_HEIGHT,
  CHANNEL_BANNER_WIDTH,
  ChannelModerationAction,
  ChannelPermissions,
  ChannelPreferences,
  ChatEvent,
  ChatInitActiveUsersEvent,
  ChatServiceErrorCode,
  ChatUserEvent,
  CreateChannelInviteLinkResponse,
  CreateChannelRequest,
  DetailedChannelInfo,
  EditChannelRequest,
  EditChannelResponse,
  GetBatchedChannelInfosResponse,
  GetChannelHistoryServerResponse,
  GetChannelInfoResponse,
  GetChannelInviteLinkResponse,
  GetOwnChannelInviteLinkResponse,
  INITIAL_CHANNEL_ID,
  InitialChannelData,
  JoinChannelResponse,
  JoinedChannelInfo,
  ListChannelBansResponse,
  ListChannelInviteLinksResponse,
  ListUserChannelEntriesResponse,
  SbChannelId,
  SearchChannelsResponse,
  ServerChatMessage,
  ServerChatMessageType,
  toChannelBanEntryJson,
  toChannelInviteLinkJson,
  toChatUserProfileJson,
  toUserChannelEntryJson,
  UserChannelEntry,
} from '../../../common/chat'
import { subtract } from '../../../common/data-structures/sets'
import { NotificationType } from '../../../common/notifications'
import { Patch } from '../../../common/patch'
import { decodePrettyId, encodePrettyId, isPrettyId } from '../../../common/pretty-id'
import { RolledOutcome, RolledOutcomeRequest } from '../../../common/rolled-outcomes'
import { AvailabilityInfo, isDefaultAvailabilityInfo } from '../../../common/users/availability'
import { RestrictionKind } from '../../../common/users/restrictions'
import { SbUser } from '../../../common/users/sb-user'
import { SbUserId } from '../../../common/users/sb-user-id'
import { DbClient } from '../db'
import { FOREIGN_KEY_VIOLATION, UNIQUE_VIOLATION } from '../db/pg-error-codes'
import transact from '../db/transaction'
import { CodedError } from '../errors/coded-error'
import { writeFile } from '../files'
import { createImagePath, resizeImage } from '../files/images'
import { ImageService } from '../images/image-service'
import logger from '../logging/logger'
import { emoteField } from '../messaging/emote-field'
import filterChatMessage from '../messaging/filter-chat-message'
import { outcomeField } from '../messaging/outcome-field'
import { processMessageContents } from '../messaging/process-chat-message'
import { rollOutcome } from '../messaging/roll-outcome'
import NotificationService from '../notifications/notification-service'
import { AvailabilityService } from '../users/availability-service'
import { MIN_IDENTIFIER_MATCHES } from '../users/client-ids'
import { RestrictionService } from '../users/restriction-service'
import { findConnectedUsers } from '../users/user-identifiers'
import { findUserById, findUsersById } from '../users/user-model'
import { UserSocketsGroup, UserSocketsManager } from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'
import {
  addMessageToChannel,
  addUserToChannel,
  banAllIdentifiersFromChannel,
  banUserFromChannel,
  ChatMessage,
  countBannedIdentifiersForChannel,
  createChannel,
  deleteChannel,
  deleteChannelMessage,
  EditableChannelFields,
  findChannelByName,
  FullChannelInfo,
  getChannelBans,
  getChannelInfo,
  getChannelInfos,
  getChannelMessageAuthor,
  getChannelMessageSentTime,
  getChannelsForUser,
  getMessagesForChannel,
  getModeratorIdsForChannels,
  getUnreadChannelInfo,
  getUserChannelEntriesForChannel,
  getUserChannelEntriesForUser,
  getUserChannelEntryForUser,
  getUsersForChannel,
  HistoryCursor,
  isUserBannedFromChannel,
  LeaveChannelResult,
  removeAllUsersFromChannel,
  removeBannedIdentifiersFromChannel,
  removeUserFromChannel,
  searchChannels,
  toBasicChannelInfo,
  toDetailedChannelInfo,
  toJoinedChannelInfo,
  transferChannelOwnership,
  unbanUserFromChannel,
  updateChannel,
  updateLastReadTime,
  updateUserPermissions,
  updateUserPreferences,
} from './chat-models'
import {
  createInviteLink,
  deleteInviteLink,
  deleteInviteLinksCreatedBy,
  deleteInviteLinksForChannel,
  deleteMemberInviteLinks,
  deleteUnusableInviteLinks,
  findNewestUsableInviteLink,
  getInviteLink,
  incrementInviteLinkUses,
  InviteLinkRecord,
  listUsableInviteLinks,
} from './invite-link-models'

class ChatState extends ImmutableRecord({
  /** Maps channel id -> Set of IDs of users in that channel. */
  channels: Map<SbChannelId, Set<SbUserId>>(),
  /** Maps userId -> Set of channels they're in (as ids). */
  users: Map<SbUserId, Set<SbChannelId>>(),
}) {}

enum JoinChannelExitCode {
  ChannelClosed = 'ChannelClosed',
  ChannelPrivate = 'ChannelPrivate',
  InviteLinkInvalid = 'InviteLinkInvalid',
  MaximumJoinedChannels = 'MaximumJoinedChannels',
  MaximumOwnedChannels = 'MaximumOwnedChannels',
  UserBanned = 'UserBanned',
  UserChatRestricted = 'UserChatRestricted',
}

/**
 * What an attempt to put a user into a channel came to. A refusal is carried as a value rather than
 * thrown, so the transaction it happened in still commits anything recorded along the way (e.g. an
 * automated ban).
 */
type JoinOutcome =
  | { kind: 'alreadyMember'; channel: FullChannelInfo }
  | {
      kind: 'joined'
      channel: FullChannelInfo
      userChannelEntry: UserChannelEntry
      message: ChatMessage
    }
  | { kind: 'refused'; exitCode: JoinChannelExitCode }

/**
 * Returns whether an invite link still lets people in, as far as the link itself goes: it hasn't
 * expired and has uses left. The link also stops working once its channel isn't private.
 */
function isInviteLinkUsable(link: InviteLinkRecord, now: Date): boolean {
  return (
    (link.expiresAt === undefined || link.expiresAt > now) &&
    (link.maxUses === undefined || link.uses < link.maxUses)
  )
}

/** Returns the id of the invite link an invite link token names, or undefined if it names none. */
function inviteLinkIdFromToken(token: string): string | undefined {
  return isPrettyId(token) ? decodePrettyId(token) : undefined
}

/**
 * Settings chosen for a new invite link. `null` means the link never expires or has no use limit.
 * The values are expected to be among the options offered in `common/chat.ts`.
 */
export interface InviteLinkSettings {
  expiresInSeconds: number | null
  maxUses: number | null
}

function toInviteLinkJson(link: InviteLinkRecord) {
  return toChannelInviteLinkJson({
    token: encodePrettyId(link.id),
    channelId: link.channelId,
    createdBy: link.createdBy,
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    maxUses: link.maxUses,
    uses: link.uses,
  })
}

function inviteLinkInvalidError(): ChatServiceError {
  return new ChatServiceError(
    ChatServiceErrorCode.InviteLinkInvalid,
    'Invite link is invalid or has expired',
  )
}

function channelNameTakenError(): ChatServiceError {
  return new ChatServiceError(
    ChatServiceErrorCode.ChannelNameTaken,
    'A channel with that name already exists',
  )
}

/**
 * Throws if a user may not get an invite link for a channel: the channel must exist and be private,
 * and the user must be a server moderator, its owner, or a member of a channel that lets members
 * invite. Membership is checked before privacy, so a non-member learns nothing about a channel
 * beyond it existing.
 */
function ensureCanGetInviteLink(
  channel: FullChannelInfo | undefined,
  userId: SbUserId,
  userChannelEntry: UserChannelEntry | null,
  isServerModerator: boolean,
): asserts channel is FullChannelInfo {
  if (!channel) {
    throw new ChatServiceError(ChatServiceErrorCode.ChannelNotFound, 'Channel not found')
  }
  if (!userChannelEntry && !isServerModerator) {
    throw new ChatServiceError(
      ChatServiceErrorCode.NotInChannel,
      'Must be in channel to invite people to it',
    )
  }
  if (!channel.private) {
    throw new ChatServiceError(
      ChatServiceErrorCode.ChannelNotPrivate,
      'Only private channels have invite links',
    )
  }
  if (!isServerModerator && !channel.membersCanInvite && channel.ownerId !== userId) {
    throw new ChatServiceError(
      ChatServiceErrorCode.NotEnoughPermissions,
      'Only the channel owner can invite people to this channel',
    )
  }
}

/**
 * Throws if a user may not see or revoke a channel's invite links, which only its owner and server
 * moderators may.
 */
function ensureCanManageInviteLinks(
  channel: FullChannelInfo | undefined,
  userId: SbUserId,
  isServerModerator: boolean,
): asserts channel is FullChannelInfo {
  if (!channel) {
    throw new ChatServiceError(ChatServiceErrorCode.ChannelNotFound, 'Channel not found')
  }
  if (!isServerModerator && channel.ownerId !== userId) {
    throw new ChatServiceError(
      ChatServiceErrorCode.NotEnoughPermissions,
      "You don't have enough permissions to manage this channel's invite links",
    )
  }
}

export class ChatServiceError extends CodedError<ChatServiceErrorCode> {}

class RetryableError extends Error {}

/**
 * Returns whether channel permissions make their holder a channel moderator: holding any of them
 * grants moderation authority in the channel, and is what the moderator badge reflects.
 */
function holdsModerationPermission(permissions: ChannelPermissions): boolean {
  return permissions.editPermissions || permissions.ban || permissions.kick
}

export function getChannelPath(channelId: SbChannelId): string {
  return `/chat3/${channelId}`
}

export function getChannelUserPath(channelId: SbChannelId, userId: SbUserId): string {
  return `${getChannelPath(channelId)}/users/${userId}`
}

/**
 * Maximum number of times that the service will attempt to (re)join the user in case of the timing
 * issues. E.g. in case the two users attempt to join the same non-existing channel at the same
 * time, they'll both attempt to create it, but only one will succeed.
 */
const MAX_JOIN_ATTEMPTS = 3

function ensureRemovableChannel(channelId: SbChannelId) {
  if (channelId === INITIAL_CHANNEL_ID) {
    throw new ChatServiceError(
      ChatServiceErrorCode.CannotRemoveInitialChannel,
      "The channel new users join can't be closed or deleted",
    )
  }
}

@singleton()
export default class ChatService {
  private state = new ChatState()

  constructor(
    private publisher: TypedPublisher<ChatEvent | ChatUserEvent>,
    private userSocketsManager: UserSocketsManager,
    private imageService: ImageService,
    private restrictionService: RestrictionService,
    private notificationService: NotificationService,
    private availabilityService: AvailabilityService,
  ) {
    userSocketsManager
      .on('newUser', userSockets => {
        this.handleNewUser(userSockets).catch(err =>
          logger.error({ err }, 'Error handling new user in chat service'),
        )
      })
      .on('userQuit', userId => this.handleUserQuit(userId))

    availabilityService.on('change', (userId, availability, prev) => {
      // Channels assume the default for a user they've heard nothing else about, so a user coming
      // online with the default has nothing to announce.
      if (!prev && isDefaultAvailabilityInfo(availability)) {
        return
      }

      // A user whose channel list is still loading isn't in `users` yet; their `userActive2`
      // carries the availability once it has loaded.
      for (const channelId of this.state.users.get(userId)?.values() ?? []) {
        this.publisher.publish(getChannelPath(channelId), {
          action: 'userAvailability',
          userId,
          availability,
        })
      }
    })
  }

  async getJoinedChannels(userId: SbUserId): Promise<InitialChannelData[]> {
    const [joinedChannels, unreadChannelInfo] = await Promise.all([
      getChannelsForUser(userId),
      getUnreadChannelInfo(userId),
    ])
    const channelIds = joinedChannels.map(c => c.channelId)
    const [channelInfos, moderatorIdsByChannel] = await Promise.all([
      getChannelInfos(channelIds),
      getModeratorIdsForChannels(channelIds),
    ])

    const channelInfosMap = new global.Map(channelInfos.map(c => [c.id, c]))
    const unreadChannelsMap = new global.Map(unreadChannelInfo.map(c => [c.channelId, c]))

    return joinedChannels.map(c => {
      const channelInfo = channelInfosMap.get(c.channelId)!
      const unreadInfo = unreadChannelsMap.get(c.channelId)

      return {
        channelInfo: toBasicChannelInfo(channelInfo),
        detailedChannelInfo: toDetailedChannelInfo(channelInfo),
        joinedChannelInfo: toJoinedChannelInfo(channelInfo),
        selfPreferences: c.channelPreferences,
        selfPermissions: c.channelPermissions,
        moderatorIds: moderatorIdsByChannel.get(c.channelId) ?? [],
        latestUnreadTime: unreadInfo?.latestUnreadTime.getTime(),
        // The unread queries treat everything from others since `joinDate` as unread when no read
        // position has been recorded, and the divider goes before the first message *after* the
        // reported marker, so the marker has to sit one millisecond before the join.
        lastReadTime: c.lastReadTime?.getTime() ?? c.joinDate.getTime() - 1,
        latestMentionTime: unreadInfo?.latestMentionTime?.getTime(),
      }
    })
  }

  private async updateUserAfterJoining(
    userInfo: SbUser,
    channelId: SbChannelId,
    _userChannelEntry: UserChannelEntry,
    message: ChatMessage,
  ) {
    this.state = this.state
      // TODO(tec27): Remove `any` cast once Immutable properly types this call again
      .updateIn(['channels', channelId], (s = Set<SbUserId>()) => (s as any).add(userInfo.id))
      // TODO(tec27): Remove `any` cast once Immutable properly types this call again
      .updateIn(['users', userInfo.id], (s = Set<string>()) => (s as any).add(channelId))

    this.publisher.publish(getChannelPath(channelId), {
      action: 'join2',
      user: userInfo,
      availability: this.getNonDefaultAvailability(userInfo.id),
      message: {
        id: message.msgId,
        type: ServerChatMessageType.JoinChannel,
        channelId: message.channelId,
        userId: message.userId,
        time: Number(message.sent),
      },
    })

    // NOTE(tec27): We don't use the helper method here because joining channels while offline
    // is allowed in some cases (e.g. during account creation)
    const userSockets = this.userSocketsManager.getById(userInfo.id)
    if (userSockets) {
      this.subscribeUserToChannel(userSockets, channelId)

      const [channelInfo, userChannelEntry, moderatorIdsByChannel] = await Promise.all([
        getChannelInfo(channelId),
        getUserChannelEntryForUser(userSockets.userId, channelId),
        getModeratorIdsForChannels([channelId]),
      ])

      if (channelInfo && userChannelEntry) {
        // `latestUnreadTime` and `latestMentionTime` are omitted: nothing can be unread or mention
        // the user at the instant they join. `lastReadTime` is still sent, one millisecond before the
        // join, so the client can place the unread divider once messages arrive.
        this.publisher.publish(getChannelUserPath(channelId, userSockets.userId), {
          action: 'init3',
          channelInfo: toBasicChannelInfo(channelInfo),
          detailedChannelInfo: toDetailedChannelInfo(channelInfo),
          joinedChannelInfo: toJoinedChannelInfo(channelInfo),
          selfPreferences: userChannelEntry.channelPreferences,
          selfPermissions: userChannelEntry.channelPermissions,
          moderatorIds: moderatorIdsByChannel.get(channelId) ?? [],
          lastReadTime: userChannelEntry.joinDate.getTime() - 1,
        })
      }
    }
  }

  /**
   * Joins initial channel ("ShieldBattery") with account `userId`, allowing them to receive and
   * send messages in it. Assumes the "ShieldBattery" channel exists (and has ID 1), which it should
   * since it's created in the migration.
   *
   * `client` must be specified so this action happens inside a DB transaction of account creation.
   * Similarly, `transactionCompleted` should be a Promise that resolves when the transaction has
   * fully resolved.
   */
  async joinInitialChannel(
    userId: SbUserId,
    client: DbClient,
    transactionCompleted: Promise<void>,
  ): Promise<void> {
    // NOTE(tec27): VERY IMPORTANT. This method is used during user creation. You *cannot* assume
    // that any query involving the user will work unless it is done using the provided client (or
    // is done after `transactionCompleted` resolves). If you do not follow this rule, you *will*
    // break user creation and I *will* be sad :(

    const userInfo = await findUserById(userId, client)
    if (!userInfo) {
      throw new ChatServiceError(ChatServiceErrorCode.UserNotFound, "User doesn't exist")
    }

    const channelId = INITIAL_CHANNEL_ID
    const channelInfo = await getChannelInfo(channelId, client)
    if (!channelInfo) {
      throw new ChatServiceError(ChatServiceErrorCode.ChannelNotFound, 'Channel not found')
    }

    // NOTE(2Pac): This method can technically return `undefined`, but that would mean we're
    // trying to add user to a bunch of non-official channels when they create an account which,
    // you know... we probably shouldn't do.
    const userChannelEntry = (await addUserToChannel(userId, channelId, client))!
    const message = await addMessageToChannel(
      userId,
      channelId,
      {
        type: ServerChatMessageType.JoinChannel,
      },
      client,
    )

    // NOTE(tec27): We don't/can't await this because it would be a recursive async dependency
    // (this function's Promise is await'd for the transaction, and transactionCompleted is awaited
    // by this function)
    transactionCompleted
      .then(() =>
        this.updateUserAfterJoining(userInfo, channelInfo.id, userChannelEntry, message).catch(
          err => {
            logger.error({ err }, 'Error retrieving the initial channel data for the user')
          },
        ),
      )
      .catch(swallowNonBuiltins)
  }

  private async banUserFromChannelIfNeeded(
    channelId: SbChannelId,
    targetId: SbUserId,
    client: DbClient,
  ): Promise<boolean> {
    const count = await countBannedIdentifiersForChannel({ channelId, targetId }, client)
    if (count >= MIN_IDENTIFIER_MATCHES) {
      const connectedUsers = await findConnectedUsers(targetId, MIN_IDENTIFIER_MATCHES, client)
      await banUserFromChannel({ channelId, targetId, automated: true, connectedUsers }, client)
      await banAllIdentifiersFromChannel({ channelId, targetId }, client)
      // A banned user must not be able to bring others in either.
      await deleteInviteLinksCreatedBy({ channelId, userId: targetId }, client)
      return true
    }

    return false
  }

  /**
   * Puts a user into an existing channel, inside the transaction `client` belongs to. An existing
   * member is left as they are. Otherwise the user is refused if the channel is closed, if it's
   * private and `admitPrivate` isn't set, if they're banned from it (which includes being caught by
   * the automated identifier ban here), or if they've reached the joined-channel cap; anyone else
   * becomes a member, recorded as invited by `invitedBy`, and gets a join message. A non-official
   * channel without an owner (one that was closed and then reopened) is handed to whoever joins it.
   *
   * The channel's row stays locked for the rest of the transaction, so the channel can't be closed
   * or deleted between the checks here and the membership being stored.
   */
  private async admitToChannel(
    {
      channelId,
      userId,
      admitPrivate,
      invitedBy,
    }: {
      channelId: SbChannelId
      userId: SbUserId
      admitPrivate: boolean
      invitedBy?: SbUserId
    },
    client: DbClient,
  ): Promise<JoinOutcome> {
    let channel = await getChannelInfo(channelId, client, { forUpdate: true })
    if (!channel) {
      throw new ChatServiceError(ChatServiceErrorCode.ChannelNotFound, 'Channel not found')
    }

    if (await getUserChannelEntryForUser(userId, channel.id, client)) {
      return { kind: 'alreadyMember', channel }
    }

    if (channel.closed) {
      return { kind: 'refused', exitCode: JoinChannelExitCode.ChannelClosed }
    }

    // Checked before bans so that joining a private channel can't trigger the automated identifier
    // ban, and a non-member learns nothing beyond the channel being private.
    if (channel.private && !admitPrivate) {
      return { kind: 'refused', exitCode: JoinChannelExitCode.ChannelPrivate }
    }

    const isBanned = await isUserBannedFromChannel(channel.id, userId, client)
    if (isBanned || (await this.banUserFromChannelIfNeeded(channel.id, userId, client))) {
      return { kind: 'refused', exitCode: JoinChannelExitCode.UserBanned }
    }

    const userChannelEntry = await addUserToChannel(userId, channel.id, client, invitedBy)
    if (!userChannelEntry) {
      return { kind: 'refused', exitCode: JoinChannelExitCode.MaximumJoinedChannels }
    }

    if (!channel.official && channel.ownerId === undefined) {
      channel = await updateChannel(channel.id, { ownerId: userId }, client)
    }

    const message = await addMessageToChannel(
      userId,
      channel.id,
      {
        type: ServerChatMessageType.JoinChannel,
      },
      client,
    )
    return { kind: 'joined', channel, userChannelEntry, message }
  }

  /**
   * Finishes a join after its transaction has committed: a refusal becomes the matching error, and
   * a new member's join is announced to the channel and their sockets are subscribed to it.
   */
  private async completeJoin(userInfo: SbUser, outcome: JoinOutcome): Promise<JoinChannelResponse> {
    if (outcome.kind === 'refused') {
      switch (outcome.exitCode) {
        case JoinChannelExitCode.ChannelClosed:
          throw new ChatServiceError(ChatServiceErrorCode.ChannelClosed, 'Channel is closed')
        case JoinChannelExitCode.ChannelPrivate:
          throw new ChatServiceError(ChatServiceErrorCode.ChannelPrivate, 'Channel is private')
        case JoinChannelExitCode.InviteLinkInvalid:
          throw inviteLinkInvalidError()
        case JoinChannelExitCode.MaximumJoinedChannels:
          throw new ChatServiceError(
            ChatServiceErrorCode.MaximumJoinedChannels,
            'Maximum joined channels reached',
          )
        case JoinChannelExitCode.MaximumOwnedChannels:
          throw new ChatServiceError(
            ChatServiceErrorCode.MaximumOwnedChannels,
            'Maximum owned channels reached',
          )
        case JoinChannelExitCode.UserBanned:
          throw new ChatServiceError(ChatServiceErrorCode.UserBanned, 'User is banned')
        case JoinChannelExitCode.UserChatRestricted:
          throw new ChatServiceError(
            ChatServiceErrorCode.UserChatRestricted,
            'User is chat restricted',
          )
        default:
          return assertUnreachable(outcome.exitCode)
      }
    }

    const { channel } = outcome
    if (outcome.kind === 'joined') {
      try {
        await this.updateUserAfterJoining(
          userInfo,
          channel.id,
          outcome.userChannelEntry,
          outcome.message,
        )
      } catch (err) {
        throw new ChatServiceError(
          ChatServiceErrorCode.NoInitialChannelData,
          'Error retrieving the initial channel data for the user',
          { cause: err },
        )
      }
    }

    return {
      channelInfo: toBasicChannelInfo(channel),
      detailedChannelInfo: toDetailedChannelInfo(channel),
      joinedChannelInfo: toJoinedChannelInfo(channel),
    }
  }

  /**
   * Joins `channelName` with account `userId`, allowing them to receive and send messages in it.
   * Handles the use case of two users attempting to join a channel at the same time.
   *
   * A private channel only admits users who are already members, plus server moderators.
   */
  async joinChannel(
    channelName: string,
    userId: SbUserId,
    isServerModerator: boolean,
  ): Promise<JoinChannelResponse> {
    const userInfo = await findUserById(userId)
    if (!userInfo) {
      throw new ChatServiceError(ChatServiceErrorCode.UserNotFound, "User doesn't exist")
    }

    let attempts = 0
    let outcome: JoinOutcome | undefined
    do {
      attempts += 1
      try {
        await transact(async client => {
          const existingChannel = await findChannelByName(channelName, client)
          if (existingChannel) {
            try {
              outcome = await this.admitToChannel(
                { channelId: existingChannel.id, userId, admitPrivate: isServerModerator },
                client,
              )
            } catch (err: any) {
              // The channel was deleted after it was looked up (its last member left), so the next
              // attempt creates it instead.
              if (
                err.code === FOREIGN_KEY_VIOLATION ||
                (err instanceof ChatServiceError &&
                  err.code === ChatServiceErrorCode.ChannelNotFound)
              ) {
                throw new RetryableError()
              } else {
                throw err
              }
            }
          } else {
            // We prevent chat restricted users from creating new channels because they seem much
            // more likely to use it to be disruptive
            const isChatRestricted = await this.restrictionService.isRestricted(
              userId,
              RestrictionKind.Chat,
            )
            if (isChatRestricted) {
              outcome = { kind: 'refused', exitCode: JoinChannelExitCode.UserChatRestricted }
              return
            }

            try {
              const channel = await createChannel({ ownerId: userId, name: channelName }, client)
              if (!channel) {
                outcome = { kind: 'refused', exitCode: JoinChannelExitCode.MaximumOwnedChannels }
                return
              }

              const userChannelEntry = await addUserToChannel(userId, channel.id, client)
              if (!userChannelEntry) {
                // Thrown (rather than handled through an exit code, which commits) so the
                // transaction rolls the creation back: committing here would leave a zero-member
                // channel owned by a user who was never in it, squatting the name.
                throw new ChatServiceError(
                  ChatServiceErrorCode.MaximumJoinedChannels,
                  'Maximum joined channels reached',
                )
              }

              const message = await addMessageToChannel(
                userId,
                channel.id,
                {
                  type: ServerChatMessageType.JoinChannel,
                },
                client,
              )
              outcome = { kind: 'joined', channel, userChannelEntry, message }
            } catch (err: any) {
              if (err.code === UNIQUE_VIOLATION) {
                throw new RetryableError()
              } else {
                throw err
              }
            }
          }
        })
      } catch (err) {
        if (!(err instanceof RetryableError)) {
          throw err
        }
      }
    } while (!outcome && attempts < MAX_JOIN_ATTEMPTS)

    if (!outcome) {
      throw new Error(`Failed to join ${channelName} after ${attempts} attempts`)
    }

    return await this.completeJoin(userInfo, outcome)
  }

  /**
   * Creates a channel with the given settings and joins its creator to it as the owner. Unlike
   * `joinChannel`, a name that's already taken is refused rather than joined, and every setting is
   * in place from the moment the channel exists, so a private channel is never visible as public.
   */
  async createChannel({
    userId,
    settings,
    bannerFile,
    badgeFile,
  }: {
    userId: SbUserId
    settings: CreateChannelRequest
    bannerFile?: formidable.File
    badgeFile?: formidable.File
  }): Promise<JoinChannelResponse> {
    const userInfo = await findUserById(userId)
    if (!userInfo) {
      throw new ChatServiceError(ChatServiceErrorCode.UserNotFound, "User doesn't exist")
    }

    // We prevent chat restricted users from creating new channels because they seem much more
    // likely to use it to be disruptive
    if (await this.restrictionService.isRestricted(userId, RestrictionKind.Chat)) {
      throw new ChatServiceError(ChatServiceErrorCode.UserChatRestricted, 'User is chat restricted')
    }

    // Checked up front so a taken name doesn't cost an image check and upload. The insert below
    // still catches a channel created with the same name in the meantime.
    if (await findChannelByName(settings.name)) {
      throw channelNameTakenError()
    }

    const { bannerPath, badgePath } = await this.storeChannelImages(bannerFile, badgeFile)

    let outcome: JoinOutcome
    try {
      outcome = await transact(async (client): Promise<JoinOutcome> => {
        const channel = await createChannel(
          {
            ownerId: userId,
            name: settings.name,
            description: settings.description || undefined,
            topic: settings.topic || undefined,
            bannerPath,
            badgePath,
            private: settings.private,
            membersCanInvite: settings.private ? settings.membersCanInvite : undefined,
          },
          client,
        )
        if (!channel) {
          return { kind: 'refused', exitCode: JoinChannelExitCode.MaximumOwnedChannels }
        }

        const userChannelEntry = await addUserToChannel(userId, channel.id, client)
        if (!userChannelEntry) {
          // Thrown so the transaction rolls the creation back, rather than leaving a zero-member
          // channel squatting the name.
          throw new ChatServiceError(
            ChatServiceErrorCode.MaximumJoinedChannels,
            'Maximum joined channels reached',
          )
        }

        const message = await addMessageToChannel(
          userId,
          channel.id,
          { type: ServerChatMessageType.JoinChannel },
          client,
        )
        return { kind: 'joined', channel, userChannelEntry, message }
      })
    } catch (err: any) {
      if (err.code === UNIQUE_VIOLATION) {
        throw channelNameTakenError()
      }
      throw err
    }

    return await this.completeJoin(userInfo, outcome)
  }

  /**
   * Joins a user to the private channel an invite link leads into. The link is locked for the
   * whole join, so it's checked and its use counted without a concurrent join slipping in between:
   * a join either consumes one use or changes nothing. A user who is already a member succeeds
   * without consuming a use.
   */
  async joinChannelWithInviteLink(token: string, userId: SbUserId): Promise<JoinChannelResponse> {
    const userInfo = await findUserById(userId)
    if (!userInfo) {
      throw new ChatServiceError(ChatServiceErrorCode.UserNotFound, "User doesn't exist")
    }
    const linkId = inviteLinkIdFromToken(token)
    if (!linkId) {
      throw inviteLinkInvalidError()
    }

    let outcome: JoinOutcome
    try {
      outcome = await transact<JoinOutcome>(async client => {
        const link = await getInviteLink(linkId, { forUpdate: true }, client)
        if (!link || !isInviteLinkUsable(link, new Date())) {
          return { kind: 'refused', exitCode: JoinChannelExitCode.InviteLinkInvalid }
        }
        const channel = await getChannelInfo(link.channelId, client)
        if (!channel?.private) {
          return { kind: 'refused', exitCode: JoinChannelExitCode.InviteLinkInvalid }
        }

        const result = await this.admitToChannel(
          { channelId: channel.id, userId, admitPrivate: true, invitedBy: link.createdBy },
          client,
        )
        if (result.kind === 'joined') {
          await incrementInviteLinkUses(link.id, client)
        }
        return result
      })
    } catch (err: any) {
      // The channel was deleted while the user was being added to it.
      if (err.code === FOREIGN_KEY_VIOLATION) {
        throw inviteLinkInvalidError()
      }
      throw err
    }

    return await this.completeJoin(userInfo, outcome)
  }

  /**
   * Returns what an invite link leads into, to anyone holding a valid one. This is the only way a
   * non-member can see a private channel's info.
   */
  async getInviteLinkInfo(token: string, userId: SbUserId): Promise<GetChannelInviteLinkResponse> {
    const linkId = inviteLinkIdFromToken(token)
    const link = linkId ? await getInviteLink(linkId) : undefined
    if (!link || !isInviteLinkUsable(link, new Date())) {
      throw inviteLinkInvalidError()
    }

    const [channel, userChannelEntry] = await Promise.all([
      getChannelInfo(link.channelId),
      getUserChannelEntryForUser(userId, link.channelId),
    ])
    if (!channel?.private) {
      throw inviteLinkInvalidError()
    }

    return {
      channelInfo: toBasicChannelInfo(channel),
      detailedChannelInfo: toDetailedChannelInfo(channel),
      expiresAt: link.expiresAt?.getTime(),
      isMember: Boolean(userChannelEntry),
    }
  }

  /**
   * Returns the newest invite link a member of a private channel (or a server moderator) created for
   * it that still works, if there is one, so they can copy it again without creating another.
   */
  async getOwnInviteLink(
    channelId: SbChannelId,
    userId: SbUserId,
    isServerModerator: boolean,
  ): Promise<GetOwnChannelInviteLinkResponse> {
    const [channel, userChannelEntry] = await Promise.all([
      getChannelInfo(channelId),
      getUserChannelEntryForUser(userId, channelId),
    ])
    ensureCanGetInviteLink(channel, userId, userChannelEntry, isServerModerator)

    const link = await findNewestUsableInviteLink({ channelId, createdBy: userId, now: new Date() })
    return { inviteLink: link ? toInviteLinkJson(link) : undefined }
  }

  /**
   * Creates an invite link into a private channel with the given settings, for one of its members
   * (or a server moderator) to share.
   */
  async createChannelInviteLink(
    channelId: SbChannelId,
    userId: SbUserId,
    isServerModerator: boolean,
    settings: InviteLinkSettings,
  ): Promise<CreateChannelInviteLinkResponse> {
    const [channel, userChannelEntry] = await Promise.all([
      getChannelInfo(channelId),
      getUserChannelEntryForUser(userId, channelId),
    ])
    ensureCanGetInviteLink(channel, userId, userChannelEntry, isServerModerator)

    const now = new Date()
    const link = await createInviteLink({
      channelId,
      createdBy: userId,
      createdAt: now,
      expiresAt:
        settings.expiresInSeconds !== null
          ? new Date(now.getTime() + settings.expiresInSeconds * 1000)
          : undefined,
      maxUses: settings.maxUses ?? undefined,
      asServerModerator: isServerModerator,
    })
    if (!link) {
      // The channel was made public, or the user left it, after the checks above.
      const [channelNow, userChannelEntryNow] = await Promise.all([
        getChannelInfo(channelId),
        getUserChannelEntryForUser(userId, channelId),
      ])
      ensureCanGetInviteLink(channelNow, userId, userChannelEntryNow, isServerModerator)
      throw new Error('Invite link could not be created')
    }

    return { inviteLink: toInviteLinkJson(link) }
  }

  /**
   * Returns a page of a channel's invite links that still work, newest first, to its owner or a
   * server moderator. Links that no longer work are deleted along the way, which is what keeps
   * them from piling up.
   */
  async listInviteLinks({
    channelId,
    userId,
    isServerModerator,
    limit,
    offset,
    searchStr,
  }: {
    channelId: SbChannelId
    userId: SbUserId
    isServerModerator: boolean
    limit: number
    offset: number
    searchStr?: string
  }): Promise<ListChannelInviteLinksResponse> {
    const channel = await getChannelInfo(channelId)
    ensureCanManageInviteLinks(channel, userId, isServerModerator)

    const now = new Date()
    await deleteUnusableInviteLinks({ channelId, now })
    const links = await listUsableInviteLinks({ channelId, now, searchStr, limit, offset })
    const users = await findUsersById(Array.from(new global.Set(links.map(l => l.createdBy))))

    return {
      channelId,
      inviteLinks: links.map(l => toInviteLinkJson(l)),
      hasMoreInviteLinks: links.length >= limit,
      users,
    }
  }

  /**
   * Deletes one of a channel's invite links for its owner or a server moderator, after which the
   * link no longer resolves.
   */
  async revokeInviteLink({
    channelId,
    token,
    userId,
    isServerModerator,
  }: {
    channelId: SbChannelId
    token: string
    userId: SbUserId
    isServerModerator: boolean
  }): Promise<void> {
    const channel = await getChannelInfo(channelId)
    ensureCanManageInviteLinks(channel, userId, isServerModerator)

    const linkId = inviteLinkIdFromToken(token)
    if (!linkId || !(await deleteInviteLink({ channelId, id: linkId }))) {
      throw inviteLinkInvalidError()
    }
  }

  async editChannel({
    channelId,
    userId,
    isServerModerator,
    updates,
    bannerFile,
    badgeFile,
  }: {
    channelId: SbChannelId
    userId: SbUserId
    isServerModerator: boolean
    updates: EditChannelRequest
    bannerFile?: formidable.File
    badgeFile?: formidable.File
  }): Promise<EditChannelResponse> {
    const originalChannel = await getChannelInfo(channelId)

    if (!originalChannel) {
      throw new ChatServiceError(ChatServiceErrorCode.ChannelNotFound, 'Channel not found')
    }

    if (!isServerModerator && originalChannel.ownerId !== userId) {
      throw new ChatServiceError(
        ChatServiceErrorCode.CannotEditChannel,
        'Only channel owner and admins can edit the channel',
      )
    }

    // Official channels have no owner, so a private one would have nobody to let anyone in.
    if (updates.private && originalChannel.official) {
      throw new ChatServiceError(
        ChatServiceErrorCode.CannotEditChannel,
        'Official channels cannot be made private',
      )
    }

    const { bannerPath, badgePath } = await this.storeChannelImages(bannerFile, badgeFile)

    const updatedChannel: Patch<EditableChannelFields> = { ...updates }
    delete (updatedChannel as any).banner
    delete (updatedChannel as any).deleteBanner
    delete (updatedChannel as any).badge
    delete (updatedChannel as any).deleteBadge

    if (updates.deleteBanner) {
      updatedChannel.bannerPath = null
    } else if (bannerPath) {
      updatedChannel.bannerPath = bannerPath
    }
    if (updates.deleteBadge) {
      updatedChannel.badgePath = null
    } else if (badgePath) {
      updatedChannel.badgePath = badgePath
    }

    const channel =
      updates.private === false || updates.membersCanInvite === false
        ? await transact(async client => {
            const updated = await updateChannel(channelId, updatedChannel, client)
            if (updates.private === false) {
              // Invite links only work while their channel is private. Deleting them here keeps
              // the ones handed out before from working again if the channel is made private later.
              await deleteInviteLinksForChannel(channelId, client)
            } else {
              // Links members already handed out would otherwise keep letting people in after the
              // owner has taken inviting back.
              await deleteMemberInviteLinks({ channelId, ownerId: updated.ownerId }, client)
            }
            return updated
          })
        : await updateChannel(channelId, updatedChannel)

    return this.publishChannelEdit(channel)
  }

  /**
   * Checks, resizes and stores a channel's banner and badge images, returning the paths they were
   * stored at. Throws `InappropriateImage` if either image is rejected, before anything is stored.
   */
  private async storeChannelImages(
    bannerFile: formidable.File | undefined,
    badgeFile: formidable.File | undefined,
  ): Promise<{ bannerPath?: string; badgePath?: string }> {
    if (bannerFile && !(await this.imageService.isImageSafe(bannerFile.filepath))) {
      throw new ChatServiceError(
        ChatServiceErrorCode.InappropriateImage,
        'Banner image is inappropriate',
      )
    }

    if (badgeFile && !(await this.imageService.isImageSafe(badgeFile.filepath))) {
      throw new ChatServiceError(
        ChatServiceErrorCode.InappropriateImage,
        'Badge image is inappropriate',
      )
    }

    const [banner, bannerExtension] = bannerFile
      ? await resizeImage(bannerFile.filepath, CHANNEL_BANNER_WIDTH, CHANNEL_BANNER_HEIGHT, {
          fallbackType: 'jpeg',
        })
      : [undefined, undefined]
    const [badge, badgeExtension] = badgeFile
      ? await resizeImage(badgeFile.filepath, CHANNEL_BADGE_WIDTH, CHANNEL_BADGE_HEIGHT)
      : [undefined, undefined]

    let bannerPath: string | undefined
    if (banner) {
      bannerPath = createImagePath('channel-images', bannerExtension)
    }
    let badgePath: string | undefined
    if (badge) {
      badgePath = createImagePath('channel-images', badgeExtension)
    }

    // Image paths are randomly generated rather than derived from the channel, so the files can be
    // stored before the row that points at them exists. Files that never get a row are unreachable
    // and harmless, whereas a stored path pointing at a missing file would render as a broken
    // image.
    const filePromises: Array<Promise<unknown>> = []

    if (banner && bannerPath) {
      const buffer = await banner.toBuffer()
      filePromises.push(
        writeFile(bannerPath, buffer, {
          acl: 'public-read',
          type: mime.getType(bannerExtension),
        }),
      )
    }
    if (badge && badgePath) {
      const buffer = await badge.toBuffer()
      filePromises.push(
        writeFile(badgePath, buffer, {
          acl: 'public-read',
          type: mime.getType(badgeExtension),
        }),
      )
    }

    await Promise.all(filePromises)

    return { bannerPath, badgePath }
  }

  /** Tells the channel's members about its updated info, and returns that info. */
  private publishChannelEdit(channel: FullChannelInfo): EditChannelResponse {
    const response = {
      channelInfo: toBasicChannelInfo(channel),
      detailedChannelInfo: toDetailedChannelInfo(channel),
      joinedChannelInfo: toJoinedChannelInfo(channel),
    }
    this.publisher.publish(getChannelPath(channel.id), { action: 'edit', ...response })
    return response
  }

  /** Renames a channel. Only server moderators can rename channels. */
  async renameChannel(channelId: SbChannelId, name: string): Promise<EditChannelResponse> {
    if (!(await getChannelInfo(channelId))) {
      throw new ChatServiceError(ChatServiceErrorCode.ChannelNotFound, 'Channel not found')
    }

    let channel: FullChannelInfo
    try {
      channel = await updateChannel(channelId, { name })
    } catch (err: any) {
      if (err.code === UNIQUE_VIOLATION) {
        throw channelNameTakenError()
      }
      throw err
    }

    return this.publishChannelEdit(channel)
  }

  /**
   * Closes a channel: every member is removed from it and nobody can join it until it's reopened.
   * The channel keeps its name, history and bans, and loses its owner, so the owner isn't left
   * owning a channel they're no longer in. Only server moderators can close channels.
   */
  async closeChannel(channelId: SbChannelId): Promise<EditChannelResponse> {
    ensureRemovableChannel(channelId)

    const { channel, removedUserIds } = await transact(async client => {
      // Invite links are locked before the channel, the same order a join through one takes them.
      await deleteInviteLinksForChannel(channelId, client)
      const channel = await getChannelInfo(channelId, client, { forUpdate: true })
      if (!channel) {
        throw new ChatServiceError(ChatServiceErrorCode.ChannelNotFound, 'Channel not found')
      }
      if (channel.closed) {
        return { channel, removedUserIds: [] }
      }

      const removedUserIds = await removeAllUsersFromChannel(channelId, client)
      const closedChannel = await updateChannel(channelId, { closed: true, ownerId: null }, client)
      return { channel: closedChannel, removedUserIds }
    })

    await this.evictChannelMembers(channel, removedUserIds, NotificationType.ChannelClosed)
    return this.publishChannelEdit(channel)
  }

  /** Lets people join a closed channel again. Only server moderators can reopen channels. */
  async reopenChannel(channelId: SbChannelId): Promise<EditChannelResponse> {
    const channel = await transact(async client => {
      // A link that was being created while the channel was closed would otherwise start working.
      await deleteInviteLinksForChannel(channelId, client)
      const channel = await getChannelInfo(channelId, client, { forUpdate: true })
      if (!channel) {
        throw new ChatServiceError(ChatServiceErrorCode.ChannelNotFound, 'Channel not found')
      }

      return channel.closed ? await updateChannel(channelId, { closed: false }, client) : channel
    })

    return this.publishChannelEdit(channel)
  }

  /**
   * Deletes a channel outright, along with its messages and bans, removing every member from it.
   * Official channels can be deleted too. Only server moderators can delete channels.
   */
  async deleteChannel(channelId: SbChannelId): Promise<void> {
    ensureRemovableChannel(channelId)

    const { channel, removedUserIds } = await transact(async client => {
      // Invite links are locked before the channel, the same order a join through one takes them.
      await deleteInviteLinksForChannel(channelId, client)
      const channel = await getChannelInfo(channelId, client, { forUpdate: true })
      if (!channel) {
        throw new ChatServiceError(ChatServiceErrorCode.ChannelNotFound, 'Channel not found')
      }

      const removedUserIds = await removeAllUsersFromChannel(channelId, client)
      await deleteChannel(channelId, client)
      return { channel, removedUserIds }
    })

    await this.evictChannelMembers(channel, removedUserIds, NotificationType.ChannelDeleted)
  }

  /**
   * Tells the members that were just removed from a closed or deleted channel about it, and stops
   * sending them anything from the channel.
   */
  private async evictChannelMembers(
    channel: FullChannelInfo,
    removedUserIds: ReadonlyArray<SbUserId>,
    notificationType: NotificationType.ChannelClosed | NotificationType.ChannelDeleted,
  ) {
    this.publisher.publish(getChannelPath(channel.id), { action: 'channelRemoved' })

    for (const userId of removedUserIds) {
      const userSockets = this.userSocketsManager.getById(userId)
      if (userSockets) {
        this.unsubscribeUserFromChannel(userSockets, channel.id)
      }
      if (this.state.users.get(userId)?.has(channel.id)) {
        // TODO(tec27): Remove `any` cast once Immutable properly types this call again
        this.state = this.state.updateIn(['users', userId], u => (u as any).delete(channel.id))
      }
    }
    this.state = this.state.deleteIn(['channels', channel.id])

    await this.notificationService.addNotificationForUsers({
      userIds: removedUserIds,
      data: { type: notificationType, channelId: channel.id, channelName: channel.name },
    })
  }

  async leaveChannel(channelId: SbChannelId, userId: SbUserId): Promise<void> {
    const userSockets = this.getUserSockets(userId)
    if (
      !this.state.users.has(userSockets.userId) ||
      !this.state.users.get(userSockets.userId)!.has(channelId)
    ) {
      throw new ChatServiceError(
        ChatServiceErrorCode.NotInChannel,
        'Must be in channel to leave it',
      )
    }

    const { userWasRemoved, newOwnerId } = await this.removeUserFromChannel(channelId, userId)

    if (userWasRemoved) {
      // Only the request whose DB delete actually removed the membership publishes the event, so
      // concurrent duplicate leave requests don't each broadcast a "user has left" event.
      this.publisher.publish(getChannelPath(channelId), {
        action: 'leave2',
        userId: userSockets.userId,
        newOwnerId,
      })
    }
    this.unsubscribeUserFromChannel(userSockets, channelId)
  }

  async moderateUser(
    channelId: SbChannelId,
    userId: SbUserId,
    targetId: SbUserId,
    moderationAction: ChannelModerationAction,
    isServerModerator: boolean,
    moderationReason?: string,
  ): Promise<void> {
    const [channelInfo, userChannelEntry, targetChannelEntry] = await Promise.all([
      getChannelInfo(channelId),
      getUserChannelEntryForUser(userId, channelId),
      getUserChannelEntryForUser(targetId, channelId),
    ])

    if (!channelInfo) {
      throw new ChatServiceError(ChatServiceErrorCode.ChannelNotFound, 'Channel not found')
    }

    // Server moderators wield the channel owner's authority in every channel, which includes not
    // needing to be a member of it.
    if (!isServerModerator && !userChannelEntry) {
      throw new ChatServiceError(
        ChatServiceErrorCode.NotInChannel,
        'Must be in channel to moderate users',
      )
    }
    if (!targetChannelEntry) {
      throw new ChatServiceError(
        ChatServiceErrorCode.TargetNotInChannel,
        'User must be in channel to moderate them',
      )
    }
    if (userId === targetId) {
      throw new ChatServiceError(
        ChatServiceErrorCode.CannotModerateYourself,
        "Can't moderate yourself",
      )
    }

    const isUserChannelOwner = channelInfo.ownerId === userId
    const isTargetChannelOwner = channelInfo.ownerId === targetId

    const isUserChannelModerator =
      userChannelEntry?.channelPermissions.editPermissions ||
      userChannelEntry?.channelPermissions[moderationAction]
    const isTargetChannelModerator = holdsModerationPermission(
      targetChannelEntry.channelPermissions,
    )

    if (isTargetChannelOwner && !isServerModerator) {
      throw new ChatServiceError(
        ChatServiceErrorCode.CannotModerateChannelOwner,
        'Only server moderators can moderate channel owners',
      )
    }
    if (isTargetChannelModerator && !isServerModerator && !isUserChannelOwner) {
      throw new ChatServiceError(
        ChatServiceErrorCode.CannotModerateChannelModerator,
        'Only server moderators and channel owners can moderate channel moderators',
      )
    }
    if (!isServerModerator && !isUserChannelOwner && !isUserChannelModerator) {
      throw new ChatServiceError(
        ChatServiceErrorCode.NotEnoughPermissions,
        'Not enough permissions to moderate the user',
      )
    }

    if (moderationAction === ChannelModerationAction.Ban) {
      await transact(async client => {
        await banUserFromChannel(
          { channelId, moderatorId: userId, targetId, reason: moderationReason },
          client,
        )
        await banAllIdentifiersFromChannel({ channelId, targetId }, client)
      })
    }

    // NOTE(2Pac): New owner can technically be selected if a server moderator removes the current
    // owner.
    const { userWasRemoved, newOwnerId } = await this.removeUserFromChannel(channelId, targetId)

    if (userWasRemoved) {
      // Only the request whose DB delete actually removed the membership publishes the event, so
      // concurrent duplicate moderation requests don't each broadcast a moderation event.
      this.publisher.publish(getChannelPath(channelId), {
        action: moderationAction,
        targetId,
        channelName: channelInfo.name,
        newOwnerId,
      })
    }

    // NOTE(2Pac): We don't use the helper method here because moderating people while they're
    // offline is allowed.
    const targetSockets = this.userSocketsManager.getById(targetId)
    if (targetSockets) {
      this.unsubscribeUserFromChannel(targetSockets, channelId)
    }

    const notificationType =
      moderationAction === ChannelModerationAction.Ban
        ? NotificationType.ChannelBan
        : NotificationType.ChannelKick
    await this.notificationService.addNotification({
      userId: targetId,
      data: { type: notificationType, channelId, channelName: channelInfo.name },
    })
  }

  /**
   * Hands the ownership of a channel over to one of its other members. Ownership can also change on
   * its own when the current owner leaves or is removed from the channel.
   *
   * `MAXIMUM_OWNED_CHANNELS` caps only channel creation: like automatic succession, a transfer can
   * push the new owner past it. Owners are always members, so the number of channels anyone can own
   * stays bounded by `MAXIMUM_JOINED_CHANNELS`.
   */
  async transferOwnership(
    channelId: SbChannelId,
    userId: SbUserId,
    targetId: SbUserId,
    isServerModerator: boolean,
  ): Promise<void> {
    const [channelInfo, targetChannelEntry] = await Promise.all([
      getChannelInfo(channelId),
      getUserChannelEntryForUser(targetId, channelId),
    ])

    if (!channelInfo) {
      throw new ChatServiceError(ChatServiceErrorCode.ChannelNotFound, 'Channel not found')
    }
    // The caller's authority must be checked before anything about the target, so that callers
    // without it can't use the distinct error codes below as an oracle for a channel's membership
    // or ownership.
    if (!isServerModerator && channelInfo.ownerId !== userId) {
      throw new ChatServiceError(
        ChatServiceErrorCode.NotEnoughPermissions,
        'Only the channel owner can transfer the ownership',
      )
    }
    if (channelInfo.official) {
      throw new ChatServiceError(
        ChatServiceErrorCode.CannotChangeChannelOwner,
        "Official channels can't have an owner",
      )
    }

    if (!targetChannelEntry) {
      throw new ChatServiceError(
        ChatServiceErrorCode.TargetNotInChannel,
        'User must be in channel to transfer the ownership to them',
      )
    }
    if (channelInfo.ownerId === targetId) {
      throw new ChatServiceError(
        ChatServiceErrorCode.CannotChangeChannelOwner,
        'User is already the channel owner',
      )
    }

    const transferred = await transferChannelOwnership(channelId, targetId)
    if (!transferred) {
      // The target left (or was removed from) the channel after the membership check above.
      throw new ChatServiceError(
        ChatServiceErrorCode.TargetNotInChannel,
        'User must be in channel to transfer the ownership to them',
      )
    }

    if (!channelInfo.membersCanInvite) {
      // The previous owner is now a member who can't invite, so their links stop working too.
      await deleteMemberInviteLinks({ channelId, ownerId: targetId })
    }

    this.publisher.publish(getChannelPath(channelId), {
      action: 'ownerChanged',
      newOwnerId: targetId,
    })
  }

  async sendChatMessage(
    channelId: SbChannelId,
    userId: SbUserId,
    message: string,
    options: { emote?: boolean } = {},
  ): Promise<void> {
    await this.ensureCanSendToChannel(channelId, userId)

    const text = filterChatMessage(message)
    const [processedText, userMentions, channelMentions] = await processMessageContents(text)

    await this.storeAndPublishTextMessage({
      channelId,
      userId,
      text: processedText,
      userMentions,
      channelMentions,
      emote: options.emote,
    })
  }

  /**
   * Settles an outcome (a roll, a coin flip, an 8-ball answer, a unit quote) for a user and
   * announces it to a channel as an action line.
   *
   * The line's wording is the client's to compose from the outcome, so the message's text carries
   * only the words the user typed themselves: the question put to the 8-ball, and nothing at all
   * for any other kind. Those words are never mention-processed, since an announcement the server
   * wrote must not become a way to make it notify people.
   */
  async sendOutcome(
    channelId: SbChannelId,
    userId: SbUserId,
    request: RolledOutcomeRequest,
  ): Promise<void> {
    await this.ensureCanSendToChannel(channelId, userId)

    await this.storeAndPublishTextMessage({
      channelId,
      userId,
      text: request.kind === 'eightBall' ? filterChatMessage(request.question) : '',
      userMentions: [],
      channelMentions: [],
      emote: true,
      outcome: rollOutcome(request),
    })
  }

  /**
   * Throws unless the user is allowed to post to a channel right now: they have to be in it, and
   * not be restricted from chatting.
   */
  private async ensureCanSendToChannel(channelId: SbChannelId, userId: SbUserId): Promise<void> {
    const userSockets = this.getUserSockets(userId)
    if (
      !this.state.users.has(userSockets.userId) ||
      !this.state.users.get(userSockets.userId)!.has(channelId)
    ) {
      throw new ChatServiceError(
        ChatServiceErrorCode.NotInChannel,
        'Must be in a channel to send a message to it',
      )
    }

    const isChatRestricted = await this.restrictionService.isRestricted(
      userId,
      RestrictionKind.Chat,
    )
    if (isChatRestricted) {
      throw new ChatServiceError(ChatServiceErrorCode.UserChatRestricted, 'User is chat restricted')
    }
  }

  /** Stores a text message in a channel and hands it to everyone subscribed to that channel. */
  private async storeAndPublishTextMessage({
    channelId,
    userId,
    text,
    userMentions,
    channelMentions,
    emote,
    outcome,
  }: {
    channelId: SbChannelId
    userId: SbUserId
    text: string
    userMentions: SbUser[]
    channelMentions: FullChannelInfo[]
    emote?: boolean
    outcome?: RolledOutcome
  }): Promise<void> {
    const mentionedUserIds = userMentions.map(u => u.id)
    const mentionedChannelIds = channelMentions.map(c => c.id)
    const result = await addMessageToChannel(userId, channelId, {
      type: ServerChatMessageType.TextMessage,
      text,
      mentions: mentionedUserIds.length > 0 ? mentionedUserIds : undefined,
      channelMentions: mentionedChannelIds.length > 0 ? mentionedChannelIds : undefined,
      ...emoteField(emote),
      ...outcomeField(outcome),
    })
    // The sender just posted a message, so they're guaranteed to exist
    const user = (await findUserById(result.userId))!

    this.publisher.publish(getChannelPath(channelId), {
      action: 'message2',
      message: {
        id: result.msgId,
        type: result.data.type,
        channelId: result.channelId,
        from: result.userId,
        time: Number(result.sent),
        text: result.data.text,
        ...emoteField(result.data.emote),
        ...outcomeField(result.data.outcome),
      },
      user,
      mentions: userMentions,
      channelMentions: channelMentions.map(c => toBasicChannelInfo(c)),
    })
  }

  /**
   * Deletes a message from a channel. Server moderators can delete any message. Otherwise the user
   * must be in the channel, and any member can delete a text message they sent. Deleting anything
   * else requires being the channel's owner or holding any moderation permission in it (`kick`,
   * `ban` or `editPermissions`), and a moderator who isn't the owner can't delete messages sent by
   * the owner or by another moderator, the same as they can't kick or ban them.
   */
  async deleteMessage({
    channelId,
    messageId,
    userId,
    isServerModerator,
  }: {
    channelId: SbChannelId
    messageId: string
    userId: SbUserId
    isServerModerator: boolean
  }): Promise<void> {
    if (!isServerModerator) {
      const [channelInfo, userChannelEntry, author] = await Promise.all([
        getChannelInfo(channelId),
        getUserChannelEntryForUser(userId, channelId),
        getChannelMessageAuthor(channelId, messageId),
      ])
      if (!channelInfo) {
        throw new ChatServiceError(ChatServiceErrorCode.ChannelNotFound, 'Channel not found')
      }
      if (!userChannelEntry) {
        throw new ChatServiceError(
          ChatServiceErrorCode.NotInChannel,
          'Must be in channel to delete messages',
        )
      }

      const isOwnTextMessage =
        author?.userId === userId && author.messageType === ServerChatMessageType.TextMessage
      const isUserChannelOwner = channelInfo.ownerId === userId
      if (
        !isOwnTextMessage &&
        !isUserChannelOwner &&
        !holdsModerationPermission(userChannelEntry.channelPermissions)
      ) {
        throw new ChatServiceError(
          ChatServiceErrorCode.NotEnoughPermissions,
          'Not enough permissions to delete a message',
        )
      }
      if (author === undefined) {
        throw new ChatServiceError(ChatServiceErrorCode.MessageNotFound, 'Message not found')
      }

      if (!isUserChannelOwner && author.userId !== userId) {
        if (author.userId === channelInfo.ownerId) {
          throw new ChatServiceError(
            ChatServiceErrorCode.CannotModerateChannelOwner,
            "Only server moderators can delete the channel owner's messages",
          )
        }
        const authorChannelEntry = await getUserChannelEntryForUser(author.userId, channelId)
        if (
          authorChannelEntry &&
          holdsModerationPermission(authorChannelEntry.channelPermissions)
        ) {
          throw new ChatServiceError(
            ChatServiceErrorCode.CannotModerateChannelModerator,
            "Only server moderators and channel owners can delete channel moderators' messages",
          )
        }
      }
    }

    await deleteChannelMessage(messageId, channelId)

    this.publisher.publish(getChannelPath(channelId), {
      action: 'messageDeleted',
      messageId,
    })
  }

  async getChannelInfo(
    channelId: SbChannelId,
    userId: SbUserId,
    isServerModerator: boolean,
  ): Promise<GetChannelInfoResponse> {
    const [channelInfo, userChannelEntry] = await Promise.all([
      getChannelInfo(channelId),
      getUserChannelEntryForUser(userId, channelId),
    ])
    const isUserInChannel = Boolean(userChannelEntry)

    if (!channelInfo) {
      throw new ChatServiceError(ChatServiceErrorCode.ChannelNotFound, 'Channel not found')
    }

    // A private channel's info, its name included, is only for its members and for server
    // moderators, who hold the owner's authority in it and moderate it without joining. Anyone
    // else learns only that the channel is private.
    if (channelInfo.private && !isUserInChannel && !isServerModerator) {
      throw new ChatServiceError(ChatServiceErrorCode.ChannelPrivate, 'Channel is private')
    }

    return {
      channelInfo: toBasicChannelInfo(channelInfo),
      detailedChannelInfo: toDetailedChannelInfo(channelInfo),
      joinedChannelInfo: toJoinedChannelInfo(channelInfo),
    }
  }

  async getChannelInfos(
    channelIds: SbChannelId[],
    userId: SbUserId,
    isServerModerator = false,
  ): Promise<GetBatchedChannelInfosResponse> {
    const [channelInfos, userChannelEntries] = await Promise.all([
      getChannelInfos(channelIds),
      getUserChannelEntriesForUser(userId, channelIds),
    ])

    const userJoinedChannelsSet = new global.Set(userChannelEntries.map(e => e.channelId))
    const visibleChannelInfos: BasicChannelInfo[] = []
    const detailedChannelInfos: DetailedChannelInfo[] = []
    const joinedChannelInfos: JoinedChannelInfo[] = []
    const privateChannels: SbChannelId[] = []

    for (const channel of channelInfos) {
      // A private channel's info, its name included, is only for its members and for server
      // moderators, who hold the owner's authority in it and moderate it without joining. Anyone
      // else learns only that the id belongs to a private channel.
      if (channel.private && !userJoinedChannelsSet.has(channel.id) && !isServerModerator) {
        privateChannels.push(channel.id)
        continue
      }

      visibleChannelInfos.push(toBasicChannelInfo(channel))
      detailedChannelInfos.push(toDetailedChannelInfo(channel))
      joinedChannelInfos.push(toJoinedChannelInfo(channel))
    }

    const deletedChannels =
      channelIds.length === channelInfos.length
        ? []
        : Array.from(
            subtract(
              new global.Set(channelIds),
              channelInfos.map(c => c.id),
            ),
          )

    return {
      channelInfos: visibleChannelInfos,
      detailedChannelInfos,
      joinedChannelInfos,
      deletedChannels,
      privateChannels,
    }
  }

  async searchChannels({
    userId,
    isServerModerator,
    limit,
    offset,
    searchStr,
  }: {
    userId: SbUserId
    isServerModerator: boolean
    limit: number
    offset: number
    searchStr?: string
  }): Promise<SearchChannelsResponse> {
    // Private channels the requester may not see are filtered out by the query itself, so every
    // channel returned here is fully visible to them.
    const channels = await searchChannels({
      userId,
      includePrivate: isServerModerator,
      limit,
      offset,
      searchStr,
    })

    return {
      channelInfos: channels.map(channel => toBasicChannelInfo(channel)),
      detailedChannelInfos: channels.map(channel => toDetailedChannelInfo(channel)),
      joinedChannelInfos: channels.map(channel => toJoinedChannelInfo(channel)),
      hasMoreChannels: channels.length >= limit,
    }
  }

  async getChannelHistory({
    channelId,
    userId,
    limit,
    beforeTime,
    afterTime,
    aroundTime,
    aroundMessageId,
    isAdmin,
  }: {
    channelId: SbChannelId
    userId: SbUserId
    limit?: number
    beforeTime?: number
    afterTime?: number
    aroundTime?: number
    aroundMessageId?: string
    isAdmin?: boolean
  }): Promise<GetChannelHistoryServerResponse> {
    const isUserInChannel = Boolean(await getUserChannelEntryForUser(userId, channelId))
    if (!isAdmin && !isUserInChannel) {
      throw new ChatServiceError(
        ChatServiceErrorCode.NotInChannel,
        'Must be in a channel to retrieve message history',
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
      const sentTime = await getChannelMessageSentTime(channelId, aroundMessageId)
      if (sentTime === undefined) {
        throw new ChatServiceError(
          ChatServiceErrorCode.MessageNotFound,
          'Message not found in this channel',
        )
      }
      cursor = { kind: 'around', date: sentTime }
    }

    const {
      messages: dbMessages,
      hasMoreBefore,
      hasMoreAfter,
    } = await getMessagesForChannel(channelId, limit, cursor)

    const messages: ServerChatMessage[] = []
    const userIds = new global.Set<SbUserId>()
    const userMentionIds = new global.Set<SbUserId>()
    const channelMentionIds = new global.Set<SbChannelId>()

    for (const msg of dbMessages) {
      switch (msg.data.type) {
        case ServerChatMessageType.TextMessage:
          messages.push({
            id: msg.msgId,
            type: msg.data.type,
            channelId: msg.channelId,
            from: msg.userId,
            time: Number(msg.sent),
            text: msg.data.text,
            ...emoteField(msg.data.emote),
            ...outcomeField(msg.data.outcome),
          })
          userIds.add(msg.userId)
          for (const mentionId of msg.data.mentions ?? []) {
            userMentionIds.add(mentionId)
          }
          for (const mentionId of msg.data.channelMentions ?? []) {
            channelMentionIds.add(mentionId)
          }
          break

        case ServerChatMessageType.JoinChannel:
          messages.push({
            id: msg.msgId,
            type: msg.data.type,
            channelId: msg.channelId,
            userId: msg.userId,
            time: Number(msg.sent),
          })
          userIds.add(msg.userId)
          break

        default:
          return assertUnreachable(msg.data)
      }
    }

    const [users, userMentions, channelMentions] = await Promise.all([
      findUsersById(Array.from(userIds)),
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
      users,
      mentions: userMentions,
      channelMentions: channelMentions.map(c => toBasicChannelInfo(c)),
      deletedChannels,
      hasMoreBefore,
      hasMoreAfter,
    }
  }

  async getChannelUsers({
    channelId,
    userId,
    isAdmin,
  }: {
    channelId: SbChannelId
    userId: SbUserId
    isAdmin?: boolean
  }): Promise<SbUser[]> {
    const isUserInChannel = Boolean(await getUserChannelEntryForUser(userId, channelId))
    if (!isAdmin && !isUserInChannel) {
      throw new ChatServiceError(
        ChatServiceErrorCode.NotInChannel,
        'Must be in a channel to retrieve user list',
      )
    }

    return getUsersForChannel(channelId)
  }

  async getChatUserProfile(channelId: SbChannelId, userId: SbUserId, targetId: SbUserId) {
    const userSockets = this.getUserSockets(userId)
    if (
      !this.state.users.has(userSockets.userId) ||
      !this.state.users.get(userSockets.userId)!.has(channelId)
    ) {
      throw new ChatServiceError(
        ChatServiceErrorCode.NotInChannel,
        'Must be in a channel to retrieve user profile',
      )
    }

    const chatUser = await getUserChannelEntryForUser(targetId, channelId)
    // This usually means the user has left the channel.
    if (!chatUser) {
      // We don't throw an error here because users can still request the profile of users that have
      // left the channel. So we return a response without a profile and expect clients to handle
      // those users in any way they want.
      return {
        userId: targetId,
        channelId,
      }
    }

    const channelInfo = await getChannelInfo(chatUser.channelId)
    // NOTE(2Pac): This would be a very odd error indeed. It would mean we still have an entry for
    // this user being in this channel, but channel itself does not exist anymore.
    if (!channelInfo) {
      throw new ChatServiceError(ChatServiceErrorCode.ChannelNotFound, 'Channel not found')
    }

    const isOwner = channelInfo.ownerId === chatUser.userId

    return {
      userId: chatUser.userId,
      channelId: chatUser.channelId,
      profile: toChatUserProfileJson({
        userId: chatUser.userId,
        channelId: chatUser.channelId,
        joinDate: chatUser.joinDate,
        isModerator: isOwner || holdsModerationPermission(chatUser.channelPermissions),
      }),
    }
  }

  async getUserPermissions(
    channelId: SbChannelId,
    userId: SbUserId,
    targetId: SbUserId,
    isServerModerator: boolean,
  ) {
    const [channelInfo, userChannelEntry, targetChannelEntry] = await Promise.all([
      getChannelInfo(channelId),
      getUserChannelEntryForUser(userId, channelId),
      getUserChannelEntryForUser(targetId, channelId),
    ])

    if (!channelInfo) {
      throw new ChatServiceError(ChatServiceErrorCode.ChannelNotFound, 'Channel not found')
    }

    // Server moderators wield the channel owner's authority in every channel, which includes not
    // needing to be a member of it.
    if (!isServerModerator && !userChannelEntry) {
      throw new ChatServiceError(
        ChatServiceErrorCode.NotInChannel,
        "Must be in channel to get user's permissions",
      )
    }
    if (!targetChannelEntry) {
      throw new ChatServiceError(
        ChatServiceErrorCode.TargetNotInChannel,
        'User must be in channel to get their permissions',
      )
    }

    const isUserChannelOwner = channelInfo.ownerId === userId
    if (
      !isServerModerator &&
      !isUserChannelOwner &&
      !userChannelEntry?.channelPermissions.editPermissions
    ) {
      throw new ChatServiceError(
        ChatServiceErrorCode.NotEnoughPermissions,
        "You don't have enough permissions to get other user's permissions",
      )
    }

    return {
      userId: targetChannelEntry.userId,
      channelId: targetChannelEntry.channelId,
      permissions: targetChannelEntry.channelPermissions,
    }
  }

  async listUserChannelEntries({
    channelId,
    userId,
    isServerModerator,
    limit,
    offset,
    searchStr,
  }: {
    channelId: SbChannelId
    userId: SbUserId
    isServerModerator: boolean
    limit: number
    offset: number
    searchStr?: string
  }): Promise<ListUserChannelEntriesResponse> {
    const [channelInfo, userChannelEntry] = await Promise.all([
      getChannelInfo(channelId),
      getUserChannelEntryForUser(userId, channelId),
    ])

    if (!channelInfo) {
      throw new ChatServiceError(ChatServiceErrorCode.ChannelNotFound, 'Channel not found')
    }

    // Server moderators wield the channel owner's authority in every channel, which includes not
    // needing to be a member of it.
    if (!isServerModerator && !userChannelEntry) {
      throw new ChatServiceError(
        ChatServiceErrorCode.NotInChannel,
        'Must be in channel to view user channel entries',
      )
    }

    const isUserChannelOwner = channelInfo.ownerId === userId
    if (
      !isServerModerator &&
      !isUserChannelOwner &&
      !userChannelEntry?.channelPermissions.editPermissions
    ) {
      throw new ChatServiceError(
        ChatServiceErrorCode.NotEnoughPermissions,
        "You don't have enough permissions to view user channel entries",
      )
    }

    const userChannelEntries = await getUserChannelEntriesForChannel({
      channelId,
      limit,
      offset,
      searchStr,
    })
    const userIds = userChannelEntries.map(u => u.userId)
    const users = await findUsersById(userIds)

    return {
      channelId,
      userChannelEntries: userChannelEntries.map(u => toUserChannelEntryJson(u)),
      hasMoreUsers: userChannelEntries.length >= limit,
      users,
    }
  }

  async listChannelBans({
    channelId,
    userId,
    isServerModerator,
    limit,
    offset,
    searchStr,
  }: {
    channelId: SbChannelId
    userId: SbUserId
    isServerModerator: boolean
    limit: number
    offset: number
    searchStr?: string
  }): Promise<ListChannelBansResponse> {
    const [channelInfo, userChannelEntry] = await Promise.all([
      getChannelInfo(channelId),
      getUserChannelEntryForUser(userId, channelId),
    ])

    if (!channelInfo) {
      throw new ChatServiceError(ChatServiceErrorCode.ChannelNotFound, 'Channel not found')
    }

    // Server moderators wield the channel owner's authority in every channel, which includes not
    // needing to be a member of it.
    if (!isServerModerator && !userChannelEntry) {
      throw new ChatServiceError(
        ChatServiceErrorCode.NotInChannel,
        'Must be in channel to view channel bans',
      )
    }

    // Unlike `listUserChannelEntries`, holders of the `ban` permission (not just
    // `editPermissions`) can also view the ban list, since they're the ones who manage bans.
    const isUserChannelOwner = channelInfo.ownerId === userId
    if (
      !isServerModerator &&
      !isUserChannelOwner &&
      !userChannelEntry?.channelPermissions.ban &&
      !userChannelEntry?.channelPermissions.editPermissions
    ) {
      throw new ChatServiceError(
        ChatServiceErrorCode.NotEnoughPermissions,
        "You don't have enough permissions to view channel bans",
      )
    }

    const bans = await getChannelBans({ channelId, limit, offset, searchStr })

    const bannedByIds = bans.map(b => b.bannedBy).filter((id): id is SbUserId => id !== undefined)
    const userIds = Array.from(new global.Set([...bans.map(b => b.userId), ...bannedByIds]))
    const users = await findUsersById(userIds)

    return {
      channelId,
      bans: bans.map(b => toChannelBanEntryJson(b)),
      hasMoreBans: bans.length >= limit,
      users,
    }
  }

  async unbanUser({
    channelId,
    userId,
    targetId,
    isServerModerator,
  }: {
    channelId: SbChannelId
    userId: SbUserId
    targetId: SbUserId
    isServerModerator: boolean
  }): Promise<void> {
    const [channelInfo, userChannelEntry] = await Promise.all([
      getChannelInfo(channelId),
      getUserChannelEntryForUser(userId, channelId),
    ])

    if (!channelInfo) {
      throw new ChatServiceError(ChatServiceErrorCode.ChannelNotFound, 'Channel not found')
    }

    // Server moderators wield the channel owner's authority in every channel, which includes not
    // needing to be a member of it.
    if (!isServerModerator && !userChannelEntry) {
      throw new ChatServiceError(
        ChatServiceErrorCode.NotInChannel,
        'Must be in channel to unban users',
      )
    }

    // Banned users hold no channel permissions and aren't members, so there's no target hierarchy
    // to check here (unlike `moderateUser`/`updateUserPermissions`).
    const isUserChannelOwner = channelInfo.ownerId === userId
    if (
      !isServerModerator &&
      !isUserChannelOwner &&
      !userChannelEntry?.channelPermissions.ban &&
      !userChannelEntry?.channelPermissions.editPermissions
    ) {
      throw new ChatServiceError(
        ChatServiceErrorCode.NotEnoughPermissions,
        "You don't have enough permissions to unban users",
      )
    }

    await transact(async client => {
      const wasBanned = await unbanUserFromChannel({ channelId, targetId }, client)
      if (!wasBanned) {
        throw new ChatServiceError(ChatServiceErrorCode.TargetNotBanned, 'User is not banned')
      }

      await removeBannedIdentifiersFromChannel({ channelId, targetId }, client)
    })

    await this.notificationService.addNotification({
      userId: targetId,
      data: {
        type: NotificationType.ChannelUnban,
        channelId,
        channelName: channelInfo.name,
      },
    })
  }

  async updateUserPreferences(
    channelId: SbChannelId,
    userId: SbUserId,
    preferences: Patch<ChannelPreferences>,
  ) {
    const [channelInfo, userChannelEntry] = await Promise.all([
      getChannelInfo(channelId),
      getUserChannelEntryForUser(userId, channelId),
    ])

    if (!channelInfo) {
      throw new ChatServiceError(ChatServiceErrorCode.ChannelNotFound, 'Channel not found')
    }
    if (!userChannelEntry) {
      throw new ChatServiceError(
        ChatServiceErrorCode.NotInChannel,
        'Must be in channel to update preferences',
      )
    }

    const { channelPreferences } = await updateUserPreferences(channelId, userId, preferences)
    this.publisher.publish(getChannelUserPath(channelId, userId), {
      action: 'preferencesChanged',
      selfPreferences: channelPreferences,
    })
  }

  /**
   * Records the newest message time a user has seen in a channel, and publishes the resulting
   * read position to all of that user's connected sessions (so a mark-read made in one session
   * updates the unread badges and read positions of their others). A no-op if they aren't a member
   * of the channel (e.g. a stale report arriving after they left).
   */
  async markRead(channelId: SbChannelId, userId: SbUserId, lastReadTime: Date): Promise<void> {
    const stored = await updateLastReadTime(userId, channelId, lastReadTime)
    if (stored !== undefined) {
      this.publisher.publish(getChannelUserPath(channelId, userId), {
        action: 'lastReadTimeChanged',
        lastReadTime: stored.getTime(),
      })
    }
  }

  async updateUserPermissions(
    channelId: SbChannelId,
    userId: SbUserId,
    targetId: SbUserId,
    permissions: ChannelPermissions,
    isServerModerator: boolean,
  ) {
    const [channelInfo, userChannelEntry, targetChannelEntry] = await Promise.all([
      getChannelInfo(channelId),
      getUserChannelEntryForUser(userId, channelId),
      getUserChannelEntryForUser(targetId, channelId),
    ])

    if (!channelInfo) {
      throw new ChatServiceError(ChatServiceErrorCode.ChannelNotFound, 'Channel not found')
    }

    // Server moderators wield the channel owner's authority in every channel, which includes not
    // needing to be a member of it.
    if (!isServerModerator && !userChannelEntry) {
      throw new ChatServiceError(
        ChatServiceErrorCode.NotInChannel,
        "Must be in channel to update user's permissions",
      )
    }
    if (!targetChannelEntry) {
      throw new ChatServiceError(
        ChatServiceErrorCode.TargetNotInChannel,
        'User must be in channel to update their permissions',
      )
    }

    const isUserChannelOwner = channelInfo.ownerId === userId
    if (
      !isServerModerator &&
      !isUserChannelOwner &&
      !userChannelEntry?.channelPermissions.editPermissions
    ) {
      throw new ChatServiceError(
        ChatServiceErrorCode.NotEnoughPermissions,
        "You don't have enough permissions to update other user's permissions",
      )
    }

    // Restrict which users can be targeted, mirroring the hierarchy enforced by `moderateUser`.
    // Without this, a delegated moderator (someone with `editPermissions` who isn't the owner or a
    // server moderator) could zero out a fellow moderator's permissions and then kick/ban them,
    // laundering around the restrictions in `moderateUser`. Editing your own permissions is still
    // allowed.
    const isTargetChannelOwner = channelInfo.ownerId === targetId
    const isTargetChannelModerator = holdsModerationPermission(
      targetChannelEntry.channelPermissions,
    )

    if (isTargetChannelOwner) {
      // The owner's authority derives from being the owner rather than from these flags, so editing
      // them is meaningless. We reject it outright to keep the owner's row immutable and consistent
      // with the client, which disables editing the owner.
      throw new ChatServiceError(
        ChatServiceErrorCode.NotEnoughPermissions,
        "Can't update the channel owner's permissions",
      )
    }
    if (
      targetId !== userId &&
      isTargetChannelModerator &&
      !isServerModerator &&
      !isUserChannelOwner
    ) {
      throw new ChatServiceError(
        ChatServiceErrorCode.NotEnoughPermissions,
        "You don't have enough permissions to update another moderator's permissions",
      )
    }

    await updateUserPermissions(channelId, targetId, permissions)
    this.publisher.publish(getChannelUserPath(channelId, targetId), {
      action: 'permissionsChanged',
      selfPermissions: permissions,
    })

    const oldIsModerator =
      channelInfo.ownerId === targetId ||
      targetChannelEntry.channelPermissions.editPermissions ||
      targetChannelEntry.channelPermissions.ban ||
      targetChannelEntry.channelPermissions.kick
    const newIsModerator =
      channelInfo.ownerId === targetId ||
      permissions.editPermissions ||
      permissions.ban ||
      permissions.kick

    if (oldIsModerator !== newIsModerator) {
      this.publisher.publish(getChannelPath(channelId), {
        action: 'userProfileChanged',
        userId: targetId,
        isModerator: newIsModerator,
      })
    }
  }

  /**
   * Returns a user's availability for sending to channel members, who assume the default when it's
   * omitted.
   */
  private getNonDefaultAvailability(userId: SbUserId): AvailabilityInfo | undefined {
    const availability = this.availabilityService.get(userId)
    return availability && !isDefaultAvailabilityInfo(availability) ? availability : undefined
  }

  private getUserSockets(userId: SbUserId): UserSocketsGroup {
    const userSockets = this.userSocketsManager.getById(userId)
    if (!userSockets) {
      throw new ChatServiceError(ChatServiceErrorCode.UserOffline, 'User is offline')
    }

    return userSockets
  }

  private subscribeUserToChannel(userSockets: UserSocketsGroup, channelId: SbChannelId) {
    userSockets.subscribe<ChatInitActiveUsersEvent>(getChannelPath(channelId), () => {
      const activeUserIds = this.state.channels.get(channelId)?.toArray() ?? []
      const availabilities: ChatInitActiveUsersEvent['availabilities'] = []
      for (const userId of activeUserIds) {
        const availability = this.getNonDefaultAvailability(userId)
        if (availability) {
          availabilities.push({ userId, ...availability })
        }
      }

      return { action: 'initActiveUsers', activeUserIds, availabilities }
    })
    userSockets.subscribe(getChannelUserPath(channelId, userSockets.userId))
  }

  private unsubscribeUserFromChannel(user: UserSocketsGroup, channelId: SbChannelId) {
    user.unsubscribe(getChannelPath(channelId))
    user.unsubscribe(getChannelUserPath(channelId, user.userId))
  }

  private async removeUserFromChannel(
    channelId: SbChannelId,
    userId: SbUserId,
  ): Promise<LeaveChannelResult> {
    const result = await removeUserFromChannel(userId, channelId)
    // The invite links a member created stop working once they're out of the channel, whether they
    // left or were kicked or banned. A link being created concurrently holds the membership row
    // until it's stored, so it's already stored by the time this runs.
    await deleteInviteLinksCreatedBy({ channelId, userId })

    if (this.state.channels.has(channelId)) {
      const updated = this.state.channels.get(channelId)!.delete(userId)
      this.state = updated.size
        ? this.state.setIn(['channels', channelId], updated)
        : this.state.deleteIn(['channels', channelId])
    }

    if (this.state.users.has(userId) && this.state.users.get(userId)!.has(channelId)) {
      // TODO(tec27): Remove `any` cast once Immutable properly types this call again
      this.state = this.state.updateIn(['users', userId], u => (u as any).delete(channelId))
    }

    return result
  }

  private async handleNewUser(userSockets: UserSocketsGroup) {
    const userChannels = await getChannelsForUser(userSockets.userId)
    if (!userSockets.sockets.size) {
      // The user disconnected while we were waiting for their channel list
      return
    }

    const channelIdsSet = Set(userChannels.map(c => c.channelId))
    const userIdsSet = Set(userChannels.map(u => u.userId))
    const inChannels = Map(userChannels.map(c => [c.channelId, userIdsSet]))

    this.state = this.state
      .mergeDeepIn(['channels'], inChannels)
      .setIn(['users', userSockets.userId], channelIdsSet)
    for (const userChannel of userChannels) {
      this.publisher.publish(getChannelPath(userChannel.channelId), {
        action: 'userActive2',
        userId: userSockets.userId,
        availability: this.getNonDefaultAvailability(userSockets.userId),
      })
      this.subscribeUserToChannel(userSockets, userChannel.channelId)
    }
  }

  private handleUserQuit(userId: SbUserId) {
    if (!this.state.users.has(userId)) {
      // This can happen if a user disconnects before we get their channel list back from the DB
      return
    }
    const channels = this.state.users.get(userId)!
    for (const channel of channels.values()) {
      const updated = this.state.channels.get(channel)?.delete(userId)
      this.state = updated?.size
        ? this.state.setIn(['channels', channel], updated)
        : this.state.deleteIn(['channels', channel])
    }
    this.state = this.state.deleteIn(['users', userId])

    for (const c of channels.values()) {
      this.publisher.publish(getChannelPath(c), {
        action: 'userOffline2',
        userId,
      })
    }
  }
}
