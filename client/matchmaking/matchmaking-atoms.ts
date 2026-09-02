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

const foundMatchBaseAtom = atom<FoundMatch | undefined>(undefined)
const foundMatchGenerationBaseAtom = atom(0)

/**
 * The match this client is in the accept phase for, or `undefined` when there isn't one. It is set
 * when a match is found and cleared as soon as that phase ends, whether that's the match dissolving,
 * a draft starting, or the game beginning to load.
 *
 * Writing it moves `foundMatchGenerationAtom` along. Updates to the match that's already here (the
 * accepted count and this client's accepted flag) go through the atoms below instead and leave the
 * generation alone.
 */
export const foundMatchAtom = atom(
  get => get(foundMatchBaseAtom),
  (get, set, match: FoundMatch | undefined) => {
    set(foundMatchBaseAtom, match)
    set(foundMatchGenerationBaseAtom, get(foundMatchGenerationBaseAtom) + 1)
  },
)

/**
 * Counter identifying which found match `foundMatchAtom` currently holds. Matches carry no id of
 * their own in the events that describe them, so this is what tells one found match apart from the
 * next: it changes every time a match is found, replaced, or cleared. Code that starts an accept
 * request records the generation it was sent for and compares it before acting on the result, so a
 * response that arrives after its match is gone can't be applied to the match that took its place.
 */
export const foundMatchGenerationAtom = atom(get => get(foundMatchGenerationBaseAtom))

/**
 * The `foundMatchGenerationAtom` value the most recent accept request this client sent was for, or
 * `undefined` if it hasn't sent one. `hasAcceptedAtom` only takes writes while this matches the
 * current generation, which is what keeps a late accept response from marking a match the user
 * never readied up for as accepted.
 */
export const acceptRequestGenerationAtom = atom<number | undefined>(undefined)

export const matchLaunchingAtom = atom(false)

/**
 * The matchmaking type of the match currently launching, set alongside `matchLaunchingAtom`.
 * `foundMatchAtom` is cleared before the launching-game dialog opens, so this carries the type
 * forward for that dialog to display. Stays `undefined` for non-matchmaking (lobby) game
 * launches, which use the same launching-game dialog.
 */
export const launchingMatchmakingTypeAtom = atom<MatchmakingType | undefined>(undefined)

export function clearMatchmakingState(storeOrSetter: JotaiStore | Setter) {
  const setter = 'set' in storeOrSetter ? storeOrSetter.set.bind(storeOrSetter) : storeOrSetter
  setter(currentSearchInfoAtom, undefined)
  setter(foundMatchAtom, undefined)
  setter(matchLaunchingAtom, false)
  setter(launchingMatchmakingTypeAtom, undefined)
}

/**
 * Whether this client has accepted the current found match. Only the client's own accept request
 * can write this, and only while the match that request was sent for is still the one being
 * accepted: accepts are answered asynchronously, so a response can outlive the match it was sent
 * for and must not carry its result over to the match that replaced it.
 */
export const hasAcceptedAtom = atom(
  get => get(foundMatchBaseAtom)?.hasAccepted ?? false,
  (get, set, hasAccepted: boolean) => {
    if (get(acceptRequestGenerationAtom) !== get(foundMatchGenerationBaseAtom)) {
      return
    }

    set(foundMatchBaseAtom, match => {
      if (!match) return undefined
      return {
        ...match,
        hasAccepted,
      }
    })
  },
)

export const acceptedPlayersAtom = atom(
  get => get(foundMatchBaseAtom)?.acceptedPlayers ?? 0,
  (_get, set, acceptedPlayers: number) => {
    set(foundMatchBaseAtom, match => {
      if (!match) return undefined
      return {
        ...match,
        acceptedPlayers,
      }
    })
  },
)
