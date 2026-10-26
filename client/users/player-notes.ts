import { SbUserId } from '../../common/users/sb-user-id'
import { useUserLocalStorageValue } from '../react/state-hooks'

/** The most characters a player note can hold. */
export const PLAYER_NOTE_MAX_LENGTH = 500

function validatePlayerNote(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Hook for the private note the current user has written about another player. Notes live only in
 * this device's local storage, scoped to the logged-in user, and are keyed by user ID so they stay
 * attached to a player through renames. Storing an empty (or whitespace-only) note deletes it.
 */
export function usePlayerNote(
  userId: SbUserId,
): [note: string | undefined, storeNote: (note: string | undefined) => void] {
  const [note, setNote] = useUserLocalStorageValue<string | undefined>(
    `playerNote.${userId}`,
    undefined,
    validatePlayerNote,
  )

  return [
    note,
    newNote => {
      const trimmed = newNote?.trim().slice(0, PLAYER_NOTE_MAX_LENGTH)
      setNote(trimmed ? trimmed : undefined)
    },
  ]
}
