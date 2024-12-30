import { GetRankForUserResponse, GetRankingsResponse } from '../../common/ladder/ladder'
import { MatchmakingType, SeasonId } from '../../common/matchmaking'
import { apiUrl, urlPath } from '../../common/urls'
import { ThunkAction } from '../dispatch-registry'
import { push } from '../navigation/routing'
import { RequestHandlingSpec, abortableThunk } from '../network/abortable-thunk'
import { fetchJson } from '../network/fetch'

const LADDER_RANKINGS_CACHE_TIME_MS = 60 * 1000

const lastFetchTimeByMatchmakingType = new Map<MatchmakingType, number>()
const lastSearchTimeByMatchmakingType = new Map<MatchmakingType, number>()
const lastSearchQueryByMatchmakingType = new Map<MatchmakingType, string>()

const lastFetchTimeBySeasonIdAndMatchmakingType = new Map<SeasonId, Map<MatchmakingType, number>>()
const lastSearchTimeBySeasonIdAndMatchmakingType = new Map<SeasonId, Map<MatchmakingType, number>>()
const lastSearchQueryBySeasonIdAndMatchmakingType = new Map<
  SeasonId,
  Map<MatchmakingType, string>
>()

export function getRankings(
  matchmakingType: MatchmakingType,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const fetchTime = performance.now()
    const lastFetchTime = lastFetchTimeByMatchmakingType.get(matchmakingType)

    if (lastFetchTime !== undefined && fetchTime - lastFetchTime < LADDER_RANKINGS_CACHE_TIME_MS) {
      return
    }

    lastFetchTimeByMatchmakingType.set(matchmakingType, fetchTime)

    const result = await fetchJson<GetRankingsResponse>(apiUrl`ladder/${matchmakingType}`, {
      signal: spec.signal,
    })

    // Don't update the state if we aren't the last request outstanding
    if (fetchTime >= (lastFetchTimeByMatchmakingType.get(matchmakingType) ?? 0)) {
      dispatch({
        type: '@ladder/getRankings',
        payload: result,
        meta: { matchmakingType, fetchTime: new Date() },
      })
    }
  })
}

export function getRankingsForPastSeason(
  seasonId: SeasonId,
  matchmakingType: MatchmakingType,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const fetchTime = performance.now()
    const lastFetchTime = lastFetchTimeBySeasonIdAndMatchmakingType
      .get(seasonId)
      ?.get(matchmakingType)

    if (lastFetchTime !== undefined && fetchTime - lastFetchTime < LADDER_RANKINGS_CACHE_TIME_MS) {
      return
    }

    if (lastFetchTimeBySeasonIdAndMatchmakingType.has(seasonId)) {
      lastFetchTimeBySeasonIdAndMatchmakingType.get(seasonId)!.set(matchmakingType, fetchTime)
    } else {
      lastFetchTimeBySeasonIdAndMatchmakingType.set(
        seasonId,
        new Map([[matchmakingType, fetchTime]]),
      )
    }

    const result = await fetchJson<GetRankingsResponse>(
      apiUrl`ladder/${matchmakingType}/${seasonId}`,
      {
        signal: spec.signal,
      },
    )

    // Don't update the state if we aren't the last request outstanding
    if (
      fetchTime >=
      (lastFetchTimeBySeasonIdAndMatchmakingType.get(seasonId)?.get(matchmakingType) ?? 0)
    ) {
      dispatch({
        type: '@ladder/getRankings',
        payload: result,
        meta: { matchmakingType, fetchTime: new Date() },
      })
    }
  })
}

export function searchRankings(
  matchmakingType: MatchmakingType,
  searchQuery: string,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const fetchTime = performance.now()
    const lastSearchTime = lastSearchTimeByMatchmakingType.get(matchmakingType)
    const lastSearchQuery = lastSearchQueryByMatchmakingType.get(matchmakingType)

    if (
      lastSearchTime !== undefined &&
      fetchTime - lastSearchTime < LADDER_RANKINGS_CACHE_TIME_MS &&
      lastSearchQuery === searchQuery
    ) {
      return
    }

    lastSearchTimeByMatchmakingType.set(matchmakingType, fetchTime)
    lastSearchQueryByMatchmakingType.set(matchmakingType, searchQuery)

    const result = await fetchJson<GetRankingsResponse>(
      apiUrl`ladder/${matchmakingType}` + (searchQuery ? urlPath`?q=${searchQuery}` : ''),
      {
        signal: spec.signal,
      },
    )

    // Don't update the state if we aren't the last request outstanding
    if (fetchTime >= (lastFetchTimeByMatchmakingType.get(matchmakingType) ?? 0)) {
      dispatch({
        type: '@ladder/searchRankings',
        payload: result,
        meta: { matchmakingType, searchQuery, fetchTime: new Date() },
      })
    }
  })
}

export function searchRankingsForPastSeason(
  seasonId: SeasonId,
  matchmakingType: MatchmakingType,
  searchQuery: string,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const fetchTime = performance.now()
    const lastSearchTime = lastSearchTimeBySeasonIdAndMatchmakingType
      .get(seasonId)
      ?.get(matchmakingType)
    const lastSearchQuery = lastSearchQueryBySeasonIdAndMatchmakingType
      .get(seasonId)
      ?.get(matchmakingType)

    if (
      lastSearchTime !== undefined &&
      fetchTime - lastSearchTime < LADDER_RANKINGS_CACHE_TIME_MS &&
      lastSearchQuery === searchQuery
    ) {
      return
    }

    if (lastSearchTimeBySeasonIdAndMatchmakingType.has(seasonId)) {
      lastSearchTimeBySeasonIdAndMatchmakingType.get(seasonId)!.set(matchmakingType, fetchTime)
    } else {
      lastSearchTimeBySeasonIdAndMatchmakingType.set(
        seasonId,
        new Map([[matchmakingType, fetchTime]]),
      )
    }
    if (lastSearchQueryBySeasonIdAndMatchmakingType.has(seasonId)) {
      lastSearchQueryBySeasonIdAndMatchmakingType.get(seasonId)!.set(matchmakingType, searchQuery)
    } else {
      lastSearchQueryBySeasonIdAndMatchmakingType.set(
        seasonId,
        new Map([[matchmakingType, searchQuery]]),
      )
    }

    const result = await fetchJson<GetRankingsResponse>(
      apiUrl`ladder/${matchmakingType}/${seasonId}` +
        (searchQuery ? urlPath`?q=${searchQuery}` : ''),
      {
        signal: spec.signal,
      },
    )

    // Don't update the state if we aren't the last request outstanding
    if (fetchTime >= (lastFetchTimeByMatchmakingType.get(matchmakingType) ?? 0)) {
      dispatch({
        type: '@ladder/searchRankings',
        payload: result,
        meta: { matchmakingType, searchQuery, fetchTime: new Date() },
      })
    }
  })
}

export function getInstantaneousSelfRank(spec: RequestHandlingSpec<void>): ThunkAction {
  return abortableThunk(spec, async (dispatch, getState) => {
    const { auth } = getState()
    const selfId = auth.self!.user.id

    const result = await fetchJson<GetRankForUserResponse>(apiUrl`ladder/users/${selfId}`, {
      signal: spec.signal,
    })

    dispatch({
      type: '@ladder/getInstantaneousSelfRank',
      payload: result,
    })
  })
}

/** Navigates to the ladder standings (optionally for a given matchmaking type). */
export function navigateToLadder(type?: MatchmakingType, seasonId?: SeasonId, transitionFn = push) {
  transitionFn(urlPath`/ladder/${type ?? ''}` + (seasonId ? urlPath`/${seasonId}` : ''))
}
