import { GetRankForUserResponse, GetRankingsResponse } from '../../common/ladder/ladder'
import {
  makeMatchmakingTypeAndSeasonId,
  MatchmakingType,
  MatchmakingTypeAndSeasonId,
  SeasonId,
} from '../../common/matchmaking'
import { apiUrl, urlPath } from '../../common/urls'
import { ThunkAction } from '../dispatch-registry'
import { push } from '../navigation/routing'
import { abortableThunk, RequestHandlingSpec } from '../network/abortable-thunk'
import { fetchJson } from '../network/fetch'

const LADDER_RANKINGS_CACHE_TIME_MS = 60 * 1000

const lastFetchTimeBySeasonIdAndMatchmakingType = new Map<MatchmakingTypeAndSeasonId, number>()
const lastSearchTimeBySeasonIdAndMatchmakingType = new Map<MatchmakingTypeAndSeasonId, number>()
const lastSearchQueryBySeasonIdAndMatchmakingType = new Map<MatchmakingTypeAndSeasonId, string>()

export function getCurrentSeasonRankings(
  matchmakingType: MatchmakingType,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const fetchTime = performance.now()
    const mapKey = makeMatchmakingTypeAndSeasonId(matchmakingType)
    const lastFetchTime = lastFetchTimeBySeasonIdAndMatchmakingType.get(mapKey)

    if (lastFetchTime !== undefined && fetchTime - lastFetchTime < LADDER_RANKINGS_CACHE_TIME_MS) {
      return
    }

    const result = await fetchJson<GetRankingsResponse>(apiUrl`ladder/${matchmakingType}`, {
      signal: spec.signal,
    })

    // Don't update the state if we aren't the last request outstanding
    if (fetchTime >= (lastFetchTimeBySeasonIdAndMatchmakingType.get(mapKey) ?? 0)) {
      lastFetchTimeBySeasonIdAndMatchmakingType.set(mapKey, fetchTime)

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
  seasonId: SeasonId,
  matchmakingType: MatchmakingType,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const fetchTime = performance.now()
    const mapKey = makeMatchmakingTypeAndSeasonId(matchmakingType, seasonId)
    const lastFetchTime = lastFetchTimeBySeasonIdAndMatchmakingType.get(mapKey)

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
    if (fetchTime >= (lastFetchTimeBySeasonIdAndMatchmakingType.get(mapKey) ?? 0)) {
      lastFetchTimeBySeasonIdAndMatchmakingType.set(mapKey, fetchTime)

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
    const mapKey = makeMatchmakingTypeAndSeasonId(matchmakingType)
    const lastSearchTime = lastSearchTimeBySeasonIdAndMatchmakingType.get(mapKey)
    const lastSearchQuery = lastSearchQueryBySeasonIdAndMatchmakingType.get(mapKey)

    if (
      lastSearchTime !== undefined &&
      fetchTime - lastSearchTime < LADDER_RANKINGS_CACHE_TIME_MS &&
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

    // Don't update the state if we aren't the last request outstanding
    if (fetchTime >= (lastSearchTimeBySeasonIdAndMatchmakingType.get(mapKey) ?? 0)) {
      lastSearchTimeBySeasonIdAndMatchmakingType.set(mapKey, fetchTime)
      lastSearchQueryBySeasonIdAndMatchmakingType.set(mapKey, searchQuery)

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
  seasonId: SeasonId,
  matchmakingType: MatchmakingType,
  searchQuery: string,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const fetchTime = performance.now()
    const mapKey = makeMatchmakingTypeAndSeasonId(matchmakingType, seasonId)
    const lastSearchTime = lastSearchTimeBySeasonIdAndMatchmakingType.get(mapKey)
    const lastSearchQuery = lastSearchQueryBySeasonIdAndMatchmakingType.get(mapKey)

    if (
      lastSearchTime !== undefined &&
      fetchTime - lastSearchTime < LADDER_RANKINGS_CACHE_TIME_MS &&
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

    // Don't update the state if we aren't the last request outstanding
    if (fetchTime >= (lastSearchTimeBySeasonIdAndMatchmakingType.get(mapKey) ?? 0)) {
      lastSearchTimeBySeasonIdAndMatchmakingType.set(mapKey, fetchTime)
      lastSearchQueryBySeasonIdAndMatchmakingType.set(mapKey, searchQuery)

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
  matchmakingType?: MatchmakingType,
  seasonId?: SeasonId,
  transitionFn = push,
) {
  // This case would produce non-sensical URLs, so we handle it specially.
  if (matchmakingType === undefined && seasonId) {
    transitionFn(urlPath`/ladder/${MatchmakingType.Match1v1}/${seasonId}`)
  } else {
    transitionFn(
      urlPath`/ladder/${matchmakingType ?? ''}` + (seasonId ? urlPath`/${seasonId}` : ''),
    )
  }
}
