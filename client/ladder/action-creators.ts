import { GetRankForUserResponse, GetRankingsResponse } from '../../common/ladder/ladder'
import { MatchmakingType, SeasonId } from '../../common/matchmaking'
import { apiUrl, urlPath } from '../../common/urls'
import { ThunkAction } from '../dispatch-registry'
import { push } from '../navigation/routing'
import { abortableThunk, RequestHandlingSpec } from '../network/abortable-thunk'
import { fetchJson } from '../network/fetch'

const LADDER_RANKINGS_CACHE_TIME_MS = 60 * 1000

type MatchmakingTypeAndSeasonId = `${MatchmakingType}|${SeasonId | undefined}`

const lastFetchTimeByMatchmakingTypeAndSeasonId = new Map<MatchmakingTypeAndSeasonId, number>()
const lastSearchInfoByMatchmakingTypeAndSeasonId = new Map<
  MatchmakingTypeAndSeasonId,
  { fetchTime: number; searchQuery: string }
>()

export function getCurrentSeasonRankings(
  matchmakingType: MatchmakingType,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const fetchTime = performance.now()
    const cacheKey = `${matchmakingType}|undefined` as MatchmakingTypeAndSeasonId
    const lastFetchTime = lastFetchTimeByMatchmakingTypeAndSeasonId.get(cacheKey)

    if (lastFetchTime !== undefined && fetchTime - lastFetchTime < LADDER_RANKINGS_CACHE_TIME_MS) {
      return
    }

    const result = await fetchJson<GetRankingsResponse>(apiUrl`ladder/${matchmakingType}`, {
      signal: spec.signal,
    })

    // Don't update the state if we aren't the last request outstanding
    if (fetchTime >= (lastFetchTimeByMatchmakingTypeAndSeasonId.get(cacheKey) ?? 0)) {
      lastFetchTimeByMatchmakingTypeAndSeasonId.set(cacheKey, fetchTime)

      dispatch({
        type: '@ladder/getRankings',
        payload: result,
        meta: { matchmakingType, fetchTime: new Date() },
      })

      dispatch({
        type: '@matchmaking/getCurrentMatchmakingSeason',
        payload: result.season,
      })
    }
  })
}

export function getPreviousSeasonRankings(
  matchmakingType: MatchmakingType,
  seasonId: SeasonId,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const fetchTime = performance.now()
    const cacheKey = `${matchmakingType}|${seasonId}` as MatchmakingTypeAndSeasonId
    const lastFetchTime = lastFetchTimeByMatchmakingTypeAndSeasonId.get(cacheKey)

    if (lastFetchTime !== undefined && fetchTime - lastFetchTime < LADDER_RANKINGS_CACHE_TIME_MS) {
      return
    }

    const result = await fetchJson<GetRankingsResponse>(
      apiUrl`ladder/${matchmakingType}/${seasonId}`,
      {
        signal: spec.signal,
      },
    )

    // Don't update the state if we aren't the last request outstanding
    if (fetchTime >= (lastFetchTimeByMatchmakingTypeAndSeasonId.get(cacheKey) ?? 0)) {
      lastFetchTimeByMatchmakingTypeAndSeasonId.set(cacheKey, fetchTime)

      dispatch({
        type: '@ladder/getRankings',
        payload: result,
        meta: { matchmakingType, fetchTime: new Date() },
      })
    }
  })
}

export function searchCurrentSeasonRankings(
  matchmakingType: MatchmakingType,
  searchQuery: string,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const fetchTime = performance.now()
    const cacheKey = `${matchmakingType}|undefined` as MatchmakingTypeAndSeasonId
    let { fetchTime: lastFetchTime, searchQuery: lastSearchQuery } =
      lastSearchInfoByMatchmakingTypeAndSeasonId.get(cacheKey) ?? {}

    if (
      lastFetchTime !== undefined &&
      fetchTime - lastFetchTime < LADDER_RANKINGS_CACHE_TIME_MS &&
      lastSearchQuery === searchQuery
    ) {
      return
    }

    const result = await fetchJson<GetRankingsResponse>(
      apiUrl`ladder/${matchmakingType}` + (searchQuery ? urlPath`?q=${searchQuery}` : ''),
      {
        signal: spec.signal,
      },
    )

    ;({ fetchTime: lastFetchTime, searchQuery: lastSearchQuery } =
      lastSearchInfoByMatchmakingTypeAndSeasonId.get(cacheKey) ?? {})

    // Don't update the state if we aren't the last request outstanding
    if (fetchTime >= (lastFetchTime ?? 0)) {
      lastSearchInfoByMatchmakingTypeAndSeasonId.set(cacheKey, {
        fetchTime,
        searchQuery,
      })

      dispatch({
        type: '@ladder/searchRankings',
        payload: result,
        meta: { matchmakingType, searchQuery, fetchTime: new Date() },
      })

      dispatch({
        type: '@matchmaking/getCurrentMatchmakingSeason',
        payload: result.season,
      })
    }
  })
}

export function searchPreviousSeasonRankings(
  matchmakingType: MatchmakingType,
  seasonId: SeasonId,
  searchQuery: string,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const fetchTime = performance.now()
    const cacheKey = `${matchmakingType}|${seasonId}` as MatchmakingTypeAndSeasonId
    let { fetchTime: lastFetchTime, searchQuery: lastSearchQuery } =
      lastSearchInfoByMatchmakingTypeAndSeasonId.get(cacheKey) ?? {}

    if (
      lastFetchTime !== undefined &&
      fetchTime - lastFetchTime < LADDER_RANKINGS_CACHE_TIME_MS &&
      lastSearchQuery === searchQuery
    ) {
      return
    }

    const result = await fetchJson<GetRankingsResponse>(
      apiUrl`ladder/${matchmakingType}/${seasonId}` +
        (searchQuery ? urlPath`?q=${searchQuery}` : ''),
      {
        signal: spec.signal,
      },
    )

    ;({ fetchTime: lastFetchTime, searchQuery: lastSearchQuery } =
      lastSearchInfoByMatchmakingTypeAndSeasonId.get(cacheKey) ?? {})

    // Don't update the state if we aren't the last request outstanding
    if (fetchTime >= (lastFetchTime ?? 0)) {
      lastSearchInfoByMatchmakingTypeAndSeasonId.set(cacheKey, {
        fetchTime,
        searchQuery,
      })

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

/** Navigates to the ladder rankings page (optionally for a given matchmaking type and a season). */
export function navigateToLadder(
  matchmakingType: MatchmakingType = MatchmakingType.Match1v1,
  seasonId?: SeasonId,
  transitionFn = push,
) {
  transitionFn(urlPath`/ladder/${matchmakingType}` + (seasonId ? urlPath`/${seasonId}` : ''))
}
