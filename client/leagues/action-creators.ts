import slug from 'slug'
import { ReadonlyDeep } from 'type-fest'
import {
  AdminAddLeagueRequest,
  AdminAddLeagueResponse,
  AdminEditLeagueRequest,
  AdminEditLeagueResponse,
  AdminGetLeagueResponse,
  AdminGetLeaguesResponse,
  ClientLeagueId,
  GetLeagueByIdResponse,
  GetLeagueLeaderboardResponse,
  GetLeaguesListResponse,
  JoinLeagueResponse,
  LeagueJson,
} from '../../common/leagues'
import { apiUrl, urlPath } from '../../common/urls'
import { ThunkAction } from '../dispatch-registry'
import { push, replace } from '../navigation/routing'
import { abortableThunk, RequestHandlingSpec } from '../network/abortable-thunk'
import { fetchJson } from '../network/fetch'
import { DetailsSubPage } from './details-sub-page'

/** Navigates to the leagues list. */
export function navigateToLeaguesList(transitionFn = push) {
  transitionFn(urlPath`/leagues/`)
}

/**
 * Navigates to a particular league. If the league data is available/provided, this URL will
 * include a slug (otherwise there will be a redirect once the data has loaded).
 */
export function navigateToLeague(
  leagueId: ClientLeagueId,
  leagueData?: ReadonlyDeep<LeagueJson>,
  subPage?: DetailsSubPage,
  transitionFn = push,
) {
  transitionFn(
    urlPath`/leagues/${leagueId}/${leagueData ? slug(leagueData.name) : '_'}/${subPage ?? ''}`,
  )
}

export function correctSlugForLeague(id: ClientLeagueId, name: string, subPage?: DetailsSubPage) {
  replace(urlPath`/leagues/${id}/${slug(name)}/${subPage ?? ''}`)
}

export function getLeaguesList(spec: RequestHandlingSpec<void>): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const result = await fetchJson<GetLeaguesListResponse>(apiUrl`leagues/`, {
      signal: spec.signal,
    })

    dispatch({
      type: '@leagues/getList',
      payload: result,
    })
  })
}

export function getLeagueById(id: ClientLeagueId, spec: RequestHandlingSpec<void>): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const result = await fetchJson<GetLeagueByIdResponse>(apiUrl`leagues/${id}/`, {
      signal: spec.signal,
    })

    dispatch({
      type: '@leagues/get',
      payload: result,
    })
  })
}

export function joinLeague(id: ClientLeagueId, spec: RequestHandlingSpec<void>): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const result = await fetchJson<JoinLeagueResponse>(apiUrl`leagues/${id}/join/`, {
      method: 'POST',
      signal: spec.signal,
    })

    dispatch({
      type: '@leagues/join',
      payload: result,
    })
  })
}

export function getLeagueLeaderboard(
  id: ClientLeagueId,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const result = await fetchJson<GetLeagueLeaderboardResponse>(
      apiUrl`leagues/${id}/leaderboard/`,
      {
        signal: spec.signal,
      },
    )

    dispatch({
      type: '@leagues/getLeaderboard',
      payload: result,
    })
  })
}

export function adminGetLeagues(spec: RequestHandlingSpec<AdminGetLeaguesResponse>): ThunkAction {
  return abortableThunk(spec, async () => {
    return await fetchJson(apiUrl`admin/leagues/`, { signal: spec.signal })
  })
}

export function adminGetLeague(
  id: ClientLeagueId,
  spec: RequestHandlingSpec<AdminGetLeagueResponse>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    return await fetchJson(apiUrl`admin/leagues/${id}/`, { signal: spec.signal })
  })
}

export function adminAddLeague(
  league: AdminAddLeagueRequest & { image?: Blob },
  spec: RequestHandlingSpec<AdminAddLeagueResponse>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    const formData = new FormData()
    for (const [key, value] of Object.entries(league)) {
      if (value !== undefined) {
        formData.append(key, String(value))
      }
    }

    if (league.image) {
      formData.append('image', league.image)
    }

    return await fetchJson(apiUrl`admin/leagues/`, {
      method: 'POST',
      signal: spec.signal,
      body: formData,
    })
  })
}

export function adminUpdateLeague(
  id: ClientLeagueId,
  leagueChanges: AdminEditLeagueRequest & { image?: Blob },
  spec: RequestHandlingSpec<AdminEditLeagueResponse>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    const formData = new FormData()
    for (const [key, value] of Object.entries(leagueChanges)) {
      if (value !== undefined) {
        formData.append(key, String(value))
      }
    }

    if (leagueChanges.image) {
      formData.append('image', leagueChanges.image)
    }

    return await fetchJson(apiUrl`admin/leagues/${id}/`, {
      method: 'PATCH',
      signal: spec.signal,
      body: formData,
    })
  })
}
