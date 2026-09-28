import { SbChannelId } from '../../common/chat'
import { SbUserId } from '../../common/users/sb-user-id'
import { useAppSelector } from '../redux-hooks'

/** A standing a member can hold in a chat channel beyond plain membership. */
export type ChannelRole = 'owner' | 'moderator'

/**
 * Returns the role `userId` holds in a channel, or undefined when they hold none or the channel's
 * roles are unknown (its initialization data hasn't arrived). Owning the channel outranks holding
 * moderation permissions in it, so an owner who also holds them is reported as the owner.
 */
export function getChannelRole(
  ownerId: SbUserId | undefined,
  moderatorIds: ReadonlySet<SbUserId> | undefined,
  userId: SbUserId,
): ChannelRole | undefined {
  if (ownerId === userId) {
    return 'owner'
  } else if (moderatorIds?.has(userId)) {
    return 'moderator'
  } else {
    return undefined
  }
}

/** Returns the role `userId` holds in `channelId`, see `getChannelRole`. */
export function useChannelRole(channelId: SbChannelId, userId: SbUserId): ChannelRole | undefined {
  return useAppSelector(s =>
    getChannelRole(
      s.chat.idToJoinedInfo.get(channelId)?.ownerId,
      s.chat.idToModeratorIds.get(channelId),
      userId,
    ),
  )
}
