import { UserRelationshipServiceErrorCode } from '../../common/users/relationships'
import { isFetchError } from '../network/fetch-errors'

/**
 * Returns a string intended for showing to users for a given `UserRelationshipServiceError`.
 * Messages will be prefixed with `${prefix}: `. This is safe to use with errors that may not
 * actually be `UserRelationshipServiceError`s.
 */
export function userRelationshipErrorToString(err: Error, prefix: string): string {
  if (isFetchError(err)) {
    switch (err.code) {
      case UserRelationshipServiceErrorCode.BlockedByUser:
        return `${prefix}: you have been blocked by this user`
      case UserRelationshipServiceErrorCode.InvalidSelfAction:
        return `${prefix}: you cannot perform this action on yourself`
      case UserRelationshipServiceErrorCode.LimitReached:
        return (
          `${prefix}: you have reached the maximum amount of friends or blocks, please ` +
          `remove some to add more`
        )
      case UserRelationshipServiceErrorCode.NoMatchingEntry:
        return `${prefix}: no matching entry found`
    }
  }

  return prefix
}
