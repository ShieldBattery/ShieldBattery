import { atom, useAtomValue } from 'jotai'
import { USERNAME_MAXLENGTH } from '../../common/constants'
import { GameUserAlias } from '../../common/games/game-launch-config'
import { SbUser } from '../../common/users/sb-user'
import { makeSbUserId, SbUserId } from '../../common/users/sb-user-id'
import { jotaiStore } from '../jotai-store'
import logger from '../logging/logger'
import { useAppSelector } from '../redux-hooks'

/**
 * Names the logged in user has given to other players, keyed by the aliased player's ID. Aliases
 * are stored only in this client's `localStorage` (separately for each account that logs in on it)
 * and are never sent to the server, so nobody else ever sees them.
 */
export const userAliasesAtom = atom<ReadonlyMap<SbUserId, string>>(new Map())

/** The account whose aliases are currently loaded into {@link userAliasesAtom}. */
let aliasOwner: SbUserId | undefined

/** Shares the `<userId>|<key>` format that `useUserLocalStorageValue` keys values by. */
function storageKey(ownerId: SbUserId) {
  return `${String(ownerId)}|userAliases`
}

function parseStoredAliases(json: string | null): Map<SbUserId, string> {
  const aliases = new Map<SbUserId, string>()
  if (json === null) {
    return aliases
  }

  try {
    const parsed: unknown = JSON.parse(json)
    if (parsed && typeof parsed === 'object') {
      for (const [id, alias] of Object.entries(parsed)) {
        const userId = Number(id)
        if (
          Number.isInteger(userId) &&
          userId > 0 &&
          typeof alias === 'string' &&
          alias.length > 0 &&
          alias.length <= USERNAME_MAXLENGTH
        ) {
          aliases.set(makeSbUserId(userId), alias)
        }
      }
    }
  } catch (err) {
    logger.error(`error parsing stored user aliases: ${(err as any)?.stack ?? err}`)
  }

  return aliases
}

/**
 * Loads the aliases `ownerId` has created into {@link userAliasesAtom}, or clears them if nobody is
 * logged in.
 */
export function loadUserAliases(ownerId: SbUserId | undefined) {
  aliasOwner = ownerId
  jotaiStore.set(
    userAliasesAtom,
    ownerId !== undefined
      ? parseStoredAliases(localStorage.getItem(storageKey(ownerId)))
      : new Map(),
  )
}

/** Sets (or, if `alias` is `undefined`, removes) the logged in user's alias for `userId`. */
export function setUserAlias(userId: SbUserId, alias: string | undefined) {
  if (aliasOwner === undefined) {
    logger.error('tried to set a user alias without anyone logged in')
    return
  }

  const aliases = new Map(jotaiStore.get(userAliasesAtom))
  if (alias === undefined) {
    aliases.delete(userId)
  } else {
    aliases.set(userId, alias)
  }

  const key = storageKey(aliasOwner)
  if (aliases.size) {
    localStorage.setItem(key, JSON.stringify(Object.fromEntries(aliases)))
  } else {
    localStorage.removeItem(key)
  }
  jotaiStore.set(userAliasesAtom, aliases)
}

// Keeps other windows/tabs logged into the same account in sync with alias changes made here.
window.addEventListener('storage', event => {
  if (
    aliasOwner !== undefined &&
    event.storageArea === localStorage &&
    event.key === storageKey(aliasOwner)
  ) {
    jotaiStore.set(userAliasesAtom, parseStoredAliases(event.newValue))
  }
})

/** Returns the logged in user's alias for `userId`, if they've created one. */
export function getUserAlias(userId: SbUserId): string | undefined {
  return jotaiStore.get(userAliasesAtom).get(userId)
}

/** Returns the name `user` should be shown with: their alias if they have one, else their name. */
export function getDisplayName(user: Pick<SbUser, 'id' | 'name'>): string {
  return getUserAlias(user.id) ?? user.name
}

/** Returns the users whose alias matches `name` (ignoring case, like usernames). */
export function findUsersByAlias(
  name: string,
  aliases: ReadonlyMap<SbUserId, string> = jotaiStore.get(userAliasesAtom),
): SbUserId[] {
  const lowered = name.toLowerCase()
  const matches: SbUserId[] = []
  for (const [userId, alias] of aliases) {
    if (alias.toLowerCase() === lowered) {
      matches.push(userId)
    }
  }
  return matches
}

/**
 * Returns the logged in user's aliases for handing to a game, for each aliased player that
 * `getName` knows the actual name of.
 */
export function getGameUserAliases(
  getName: (userId: SbUserId) => string | undefined,
): GameUserAlias[] {
  const result: GameUserAlias[] = []
  for (const [userId, alias] of jotaiStore.get(userAliasesAtom)) {
    const name = getName(userId)
    if (name !== undefined) {
      result.push({ userId, name, alias })
    }
  }
  return result
}

/** Hook that returns the logged in user's alias for `userId`, if they've created one. */
export function useUserAlias(userId: SbUserId | undefined): string | undefined {
  const aliases = useAtomValue(userAliasesAtom)
  return userId !== undefined ? aliases.get(userId) : undefined
}

/**
 * Hook that returns the name `userId` should be shown with: the logged in user's alias for them if
 * there is one, otherwise their actual name (or `undefined` if that hasn't been loaded).
 */
export function useDisplayName(userId: SbUserId | undefined): string | undefined {
  const alias = useUserAlias(userId)
  const name = useAppSelector(s =>
    userId !== undefined ? s.users.byId.get(userId)?.name : undefined,
  )
  return alias ?? name
}

/**
 * Hook that returns a function mapping a user to the name they should be shown with, for places
 * that show the names of a list of users.
 */
export function useDisplayNameGetter(): (user: Pick<SbUser, 'id' | 'name'>) => string {
  const aliases = useAtomValue(userAliasesAtom)
  return user => aliases.get(user.id) ?? user.name
}
