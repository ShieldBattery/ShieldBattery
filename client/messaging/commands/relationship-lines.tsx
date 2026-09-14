import { TFunction } from 'i18next'
import * as React from 'react'
import { Trans } from 'react-i18next'
import { assertUnreachable } from '../../../common/assert-unreachable'
import {
  MAX_BLOCKS,
  MAX_FRIENDS,
  UserRelationshipServiceErrorCode,
} from '../../../common/users/relationships'
import { SbUserId } from '../../../common/users/sb-user-id'
import { TransInterpolation } from '../../i18n/i18next'
import { isFetchError } from '../../network/fetch-errors'
import { ConnectedUsername } from '../../users/connected-username'
import { LocalStrong } from './local-strong'

/** What a command was trying to do to a relationship when it answered with one of these lines. */
export type RelationshipAction = 'friend' | 'unfriend' | 'block' | 'unblock' | 'accept'

/** The line saying a user isn't among the friends a command was asked to act on. */
export function notOnFriendsListLine(userId: SbUserId, t: TFunction): React.ReactNode {
  return (
    <Trans t={t} i18nKey='chat.commands.relationships.notOnFriendsList'>
      <LocalStrong>
        <ConnectedUsername userId={userId} />
      </LocalStrong>{' '}
      isn't on your friends list.
    </Trans>
  )
}

/** The line saying a user isn't among the blocks a command was asked to act on. */
export function notBlockedLine(userId: SbUserId, t: TFunction): React.ReactNode {
  return (
    <Trans t={t} i18nKey='chat.commands.relationships.notBlocked'>
      <LocalStrong>
        <ConnectedUsername userId={userId} />
      </LocalStrong>{' '}
      isn't blocked.
    </Trans>
  )
}

/** What a relationship request that failed for no more specific reason answers with. */
function genericFailureLine(
  action: RelationshipAction,
  userId: SbUserId,
  errorMessage: string,
  t: TFunction,
): React.ReactNode {
  switch (action) {
    case 'friend':
      return (
        <Trans t={t} i18nKey='chat.commands.relationships.friendFailed'>
          Couldn't send a friend request to{' '}
          <LocalStrong>
            <ConnectedUsername userId={userId} />
          </LocalStrong>
          : {{ errorMessage } as TransInterpolation}
        </Trans>
      )
    case 'unfriend':
      return (
        <Trans t={t} i18nKey='chat.commands.relationships.unfriendFailed'>
          Couldn't remove{' '}
          <LocalStrong>
            <ConnectedUsername userId={userId} />
          </LocalStrong>{' '}
          from your friends: {{ errorMessage } as TransInterpolation}
        </Trans>
      )
    case 'block':
      return (
        <Trans t={t} i18nKey='chat.commands.relationships.blockFailed'>
          Couldn't block{' '}
          <LocalStrong>
            <ConnectedUsername userId={userId} />
          </LocalStrong>
          : {{ errorMessage } as TransInterpolation}
        </Trans>
      )
    case 'unblock':
      return (
        <Trans t={t} i18nKey='chat.commands.relationships.unblockFailed'>
          Couldn't unblock{' '}
          <LocalStrong>
            <ConnectedUsername userId={userId} />
          </LocalStrong>
          : {{ errorMessage } as TransInterpolation}
        </Trans>
      )
    case 'accept':
      return (
        <Trans t={t} i18nKey='chat.commands.relationships.acceptFailed'>
          Couldn't accept{' '}
          <LocalStrong>
            <ConnectedUsername userId={userId} />
          </LocalStrong>
          's friend request: {{ errorMessage } as TransInterpolation}
        </Trans>
      )
    default:
      return assertUnreachable(action)
  }
}

/**
 * The line a friend or block request that the server refused answers with. The codes that mean
 * something the user can act on are spelled out; everything else says what was being attempted and
 * carries the error along.
 */
export function relationshipFailedLine(
  action: RelationshipAction,
  userId: SbUserId,
  err: Error,
  t: TFunction,
): React.ReactNode {
  const code = isFetchError(err) ? err.code : undefined

  if (code === UserRelationshipServiceErrorCode.BlockedByUser) {
    return (
      <Trans t={t} i18nKey='chat.commands.relationships.blockedByUser'>
        <LocalStrong>
          <ConnectedUsername userId={userId} />
        </LocalStrong>{' '}
        has blocked you.
      </Trans>
    )
  }

  if (code === UserRelationshipServiceErrorCode.LimitReached) {
    if (action === 'block') {
      const max = MAX_BLOCKS
      return (
        <Trans t={t} i18nKey='chat.commands.relationships.maxBlocks'>
          You've reached the maximum of {{ max } as TransInterpolation} blocked users.
        </Trans>
      )
    } else if (action === 'friend' || action === 'accept') {
      const max = MAX_FRIENDS
      return (
        <Trans t={t} i18nKey='chat.commands.relationships.maxFriends'>
          You've reached the maximum of {{ max } as TransInterpolation} friends.
        </Trans>
      )
    }
  }

  if (code === UserRelationshipServiceErrorCode.NoMatchingEntry) {
    if (action === 'unfriend') {
      return notOnFriendsListLine(userId, t)
    } else if (action === 'unblock') {
      return notBlockedLine(userId, t)
    } else if (action === 'accept') {
      return (
        <Trans t={t} i18nKey='chat.commands.relationships.noFriendRequest'>
          <LocalStrong>
            <ConnectedUsername userId={userId} />
          </LocalStrong>{' '}
          hasn't sent you a friend request.
        </Trans>
      )
    }
  }

  return genericFailureLine(action, userId, err.message, t)
}

/** The line a command answers with when the user named themselves as its target. */
export function selfTargetLine(
  action: Exclude<RelationshipAction, 'accept'>,
  t: TFunction,
): string {
  switch (action) {
    case 'friend':
      return t(
        'chat.commands.relationships.selfFriend',
        "You can't send yourself a friend request.",
      )
    case 'unfriend':
      return t(
        'chat.commands.relationships.selfUnfriend',
        "You can't remove yourself from your friends.",
      )
    case 'block':
      return t('chat.commands.relationships.selfBlock', "You can't block yourself.")
    case 'unblock':
      return t('chat.commands.relationships.selfUnblock', "You can't unblock yourself.")
    default:
      return assertUnreachable(action)
  }
}
