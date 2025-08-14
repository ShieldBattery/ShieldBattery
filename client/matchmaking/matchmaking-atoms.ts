import { atom, Setter } from 'jotai'
import { MatchmakingType } from '../../common/matchmaking'
import { RaceChar } from '../../common/races'
import { JotaiStore } from '../jotai-store'

export interface MatchmakingSearchInfo {
  matchmakingType: MatchmakingType
  race: RaceChar
  /** The time when the search was started (as returned by `window.performance.now()`). */
  startTime: number
}

export const currentSearchInfoAtom = atom<MatchmakingSearchInfo | undefined>(undefined)

export const isMatchmakingAtom = atom(get => !!get(currentSearchInfoAtom))

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
