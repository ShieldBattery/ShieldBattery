import { useEffect } from 'react'
import { ReadonlyDeep } from 'type-fest'
import { GetLobbySeatsResponse, LobbyPlayerSeatJson } from '../../common/lobbies/lobby-network'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { apiUrl } from '../../common/urls'
import { FetchBudget } from '../network/fetch-budget'
import { useAppDispatch } from '../redux-hooks'
import { LobbyFetchCache, useLobbyFetch } from './lobby-fetch-cache'

/**
 * How many cache-missing cached seat reads may hit the network per window. Like the summary budget
 * (see `lobby-summary.tsx`), cached reads are driven by sender-controlled chat content, so they
 * can't be allowed to fan out one request per lobby link a message list happens to contain.
 */
const seatsFetchBudget = new FetchBudget(15, 30 * 1000)

const seatsCache = new LobbyFetchCache<GetLobbySeatsResponse>(
  lobbyId => apiUrl`lobbies/${lobbyId}/seats`,
  seatsFetchBudget,
)

/** Clears the shared seats cache and fetch budget, so tests don't depend on each other. */
export function resetSeatsCacheForTesting() {
  seatsCache.reset()
}

/**
 * Loads who sits in each of a lobby's player seats, from the logged-in seats endpoint
 * (`GET /api/1/lobbies/:lobbyId/seats`), and puts the seated users into the store so their names
 * and avatars render without lookups of their own. Pass an undefined `lobbyId` to hold off loading.
 *
 * Returns the seats in seat order once they've loaded, and undefined while they're loading or if
 * they couldn't be loaded, so callers fall back to whatever they show without them. `cached` and
 * `refresh` work as they do for {@link useLobbyFetch}.
 */
export function useLobbySeats(
  lobbyId: SbLobbyId | undefined,
  options?: { cached?: boolean },
): [seats: ReadonlyDeep<LobbyPlayerSeatJson[]> | undefined, refresh: () => void] {
  const dispatch = useAppDispatch()
  const [state, refresh] = useLobbyFetch(seatsCache, lobbyId, options)
  const data = state?.status === 'loaded' ? state.data : undefined

  useEffect(() => {
    if (data) {
      dispatch({ type: '@users/loadUsers', payload: data.users })
    }
  }, [dispatch, data])

  return [data?.seats, refresh]
}
