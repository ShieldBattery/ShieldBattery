import { useCallback } from 'react'
import { SbUserId } from '../../common/users/sb-user'
import { RootState } from '../root-reducer'

// Utilities for constructing a list of user IDs sorted by their associated usernames.

export type UserEntry = [userId: SbUserId, username: string | undefined]

/**
 * Returns a function for use with `useAppSelector` that maps the given `userIds` to their
 * associated names. Should be used with `areUserEntriesEqual` when passed to `useAppSelector`.
 *
 * @example
 * const activeUserEntries = useAppSelector(
 *   useUserEntriesSelector(activeUserIds),
 *   areUserEntriesEqual,
 * )
 */
export function useUserEntriesSelector(
  userIds:
    | ReadonlySet<SbUserId>
    | ReadonlyMap<SbUserId, unknown>
    | ReadonlyArray<SbUserId>
    | undefined,
) {
  return useCallback(
    (state: RootState): ReadonlyArray<UserEntry> => {
      const isSetOrMap = userIds instanceof Set || userIds instanceof Map
      const isArray = Array.isArray(userIds)
      if (userIds === undefined || (isSetOrMap && !userIds.size) || (isArray && !userIds.length)) {
        return []
      }

      const result = Array.from<SbUserId, UserEntry>(isArray ? userIds : userIds.keys(), id => [
        id,
        state.users.byId.get(id)?.name,
      ])
      result.sort((a, b) => a[0] - b[0])
      return result
    },
    [userIds],
  )
}

/**
 * Equality function for use with `useUserEntriesSelector` that avoids unnecessary re-renders.
 */
export function areUserEntriesEqual(
  a: ReadonlyArray<UserEntry>,
  b: ReadonlyArray<UserEntry>,
): boolean {
  if (a.length !== b.length) {
    return false
  }

  for (let i = 0; i < a.length; i++) {
    const [aId, aName] = a[i]
    const [bId, bName] = b[i]
    if (aId !== bId || aName !== bName) {
      return false
    }
  }

  return true
}

/**
 * Sorts a list of `UserEntry`s by their username, pushing unloaded users to the end of the list.
 *
 * @example
 * const sortedActiveUsers = useMemo(() => sortUserEntries(activeUserEntries), [activeUserEntries])
 */
export function sortUserEntries(userEntries: ReadonlyArray<UserEntry>): SbUserId[] {
  return userEntries
    .slice()
    .sort(([aId, aName], [bId, bName]) => {
      // We put any user that still hasn't loaded at the bottom of the list
      if (aName === bName) {
        return aId - bId
      } else if (!aName) {
        return 1
      } else if (!bName) {
        return -1
      }

      return aName.localeCompare(bName)
    })
    .map(([userId]) => userId)
}
