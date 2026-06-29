import { atom, Setter } from 'jotai'
import { MatchmakingType } from '../../common/matchmaking'
import { RaceChar } from '../../common/races'
import { SbUserId } from '../../common/users/sb-user-id'
import { JotaiStore } from '../jotai-store'

export interface MatchmakingSearchInfo {
  /** Map from matchmaking type to the race selected for that type. */
  searchedTypes: Map<MatchmakingType, RaceChar>
  /** The time when the search was started (as returned by `window.performance.now()`). */
  startTime: number
}

export const currentSearchInfoAtom = atom<MatchmakingSearchInfo | undefined>(undefined)

export const isMatchmakingAtom = atom(get => !!get(currentSearchInfoAtom))

export interface FindMatchSelection {
  /** The user this selection belongs to, so it never bleeds across account switches. */
  userId: SbUserId
  /** The matchmaking types the user has checked on the find-match page. */
  types: ReadonlySet<MatchmakingType>
}

/**
 * The find-match mode selection the user has made *this session*, or `undefined` when they haven't
 * touched it yet (in which case the find-match page falls back to the server-persisted selection
 * from their most recent search). This lives in Jotai rather than component state so it survives
 * navigating away from and back to the find-match page mid-session: previously the toggles were kept
 * in `useState` and lost on unmount, so a queue → navigate → cancel cycle collapsed the selection
 * (the page fell back to a stale store value, often selecting nothing).
 */
export const findMatchSelectionAtom = atom<FindMatchSelection | undefined>(undefined)

export interface FoundMatch {
  matchmakingType: MatchmakingType
  numPlayers: number
  /** The time when the accept process started (as returned by `window.performance.now()`). */
  acceptStart: number
  /** How long the "match accept" period lasts for (in milliseconds) */
  acceptTimeTotalMillis: number

  acceptedPlayers: number
  hasAccepted: boolean
}

export const foundMatchAtom = atom<FoundMatch | undefined>(undefined)

export const matchLaunchingAtom = atom(false)

export function clearMatchmakingState(storeOrSetter: JotaiStore | Setter) {
  const setter = 'set' in storeOrSetter ? storeOrSetter.set.bind(storeOrSetter) : storeOrSetter
  setter(currentSearchInfoAtom, undefined)
  setter(foundMatchAtom, undefined)
  setter(matchLaunchingAtom, false)
}

export const hasAcceptedAtom = atom(
  get => get(foundMatchAtom)?.hasAccepted ?? false,
  (_get, set, hasAccepted: boolean) => {
    set(foundMatchAtom, match => {
      if (!match) return undefined
      return {
        ...match,
        hasAccepted,
      }
    })
  },
)

export const acceptedPlayersAtom = atom(
  get => get(foundMatchAtom)?.acceptedPlayers ?? 0,
  (_get, set, acceptedPlayers: number) => {
    set(foundMatchAtom, match => {
      if (!match) return undefined
      return {
        ...match,
        acceptedPlayers,
      }
    })
  },
)
