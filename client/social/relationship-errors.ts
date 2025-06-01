import { TFunction } from 'i18next'
import { UserRelationshipServiceErrorCode } from '../../common/users/relationships'
import { isFetchError } from '../network/fetch-errors'

/**
 * Returns a string intended for showing to users for a given `UserRelationshipServiceError`.
 * Messages will be prefixed with `${prefix}: `. This is safe to use with errors that may not
 * actually be `UserRelationshipServiceError`s.
 */
export function userRelationshipErrorToString(err: Error, prefix: string, t: TFunction): string {
  if (isFetchError(err)) {
    switch (err.code) {
      case UserRelationshipServiceErrorCode.BlockedByUser:
        return `${prefix}: ${t(
          'users.errors.friendsList.blockedByUser',
          'you have been blocked by this user',
        )}`
      case UserRelationshipServiceErrorCode.InvalidSelfAction:
        return `${prefix}: ${t(
          'users.errors.friendsList.invalidSelfAction',
          'you cannot perform this action on yourself`',
        )}`
      case UserRelationshipServiceErrorCode.LimitReached:
        return `${prefix}: ${t(
          'users.errors.friendsList.limitReached',
          'you have reached the maximum amount of friends or blocks, please remove some to add ' +
            'more',
        )}`
      case UserRelationshipServiceErrorCode.NoMatchingEntry:
        return `${prefix}: ${t(
          'users.errors.friendsList.noMatchingEntry',
          'no matching entry found',
        )}`
    }
  }

  return prefix
}
