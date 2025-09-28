import slug from 'slug'
import { ReadonlyDeep, Simplify } from 'type-fest'
import {
  AdminAddLeagueRequest,
  AdminEditLeagueRequest,
  AdminGetLeagueResponse,
  AdminGetLeaguesResponse,
  GetLeagueByIdResponse,
  GetLeagueLeaderboardResponse,
  GetLeaguesListResponse,
  JoinLeagueResponse,
  LeagueId,
  LeagueJson,
} from '../../common/leagues/leagues'
import { apiUrl, urlPath } from '../../common/urls'
import { ThunkAction } from '../dispatch-registry'
import { push, replace } from '../navigation/routing'
import { RequestHandlingSpec, abortableThunk } from '../network/abortable-thunk'
import { fetchJson } from '../network/fetch'
import { DetailsSubPage } from './details-sub-page'
import { toRouteLeagueId } from './route-league-id'

/** Navigates to the leagues list. */
export function navigateToLeaguesList(transitionFn = push) {
  transitionFn(urlPath`/leagues/`)
}

export function urlForLeague(
  leagueId: LeagueId,
  leagueData?: Simplify<ReadonlyDeep<Pick<LeagueJson, 'name'>>>,
  subPage?: DetailsSubPage,
) {
  return urlPath`/leagues/${toRouteLeagueId(leagueId)}/${
    leagueData ? slug(leagueData.name) : '_'
  }/${subPage ?? ''}`
}

/**
 * Navigates to a particular league. If the league data is available/provided, this URL will
 * include a slug (otherwise there will be a redirect once the data has loaded).
 */
export function navigateToLeague(
  leagueId: LeagueId,
  leagueData?: ReadonlyDeep<LeagueJson>,
  subPage?: DetailsSubPage,
  transitionFn = push,
) {
  transitionFn(urlForLeague(leagueId, leagueData, subPage))
}

export function correctSlugForLeague(id: LeagueId, name: string, subPage?: DetailsSubPage) {
  replace(urlPath`/leagues/${toRouteLeagueId(id)}/${slug(name)}/${subPage ?? ''}`)
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

export function getLeagueById(id: LeagueId, spec: RequestHandlingSpec<void>): ThunkAction {
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

export function joinLeague(id: LeagueId, spec: RequestHandlingSpec<void>): ThunkAction {
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

export function getLeagueLeaderboard(id: LeagueId, spec: RequestHandlingSpec<void>): ThunkAction {
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
  id: LeagueId,
  spec: RequestHandlingSpec<AdminGetLeagueResponse>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    return await fetchJson(apiUrl`admin/leagues/${id}/`, { signal: spec.signal })
  })
}

export function adminAddLeague({
  leagueData,
  leagueImage,
  leagueBadge,
  spec,
}: {
  leagueData: AdminAddLeagueRequest
  leagueImage?: File
  leagueBadge?: File
  spec: RequestHandlingSpec<void>
}): ThunkAction {
  return abortableThunk(spec, async () => {
    if (
      Object.values(leagueData).filter(c => c !== undefined).length === 0 &&
      !leagueImage &&
      !leagueBadge
    ) {
      return
    }

    const formData = new FormData()
    formData.append(
      'leagueData',
      JSON.stringify(leagueData, (_, value) => (value === '' ? null : value)),
    )

    if (leagueImage) {
      formData.append('image', leagueImage)
    }
    if (leagueBadge) {
      formData.append('badge', leagueBadge)
    }

    await fetchJson(apiUrl`admin/leagues/`, {
      method: 'POST',
      signal: spec.signal,
      body: formData,
    })
  })
}

export function adminUpdateLeague({
  id,
  leagueChanges,
  leagueImage,
  leagueBadge,
  spec,
}: {
  id: LeagueId
  leagueChanges: AdminEditLeagueRequest
  leagueImage?: File
  leagueBadge?: File
  spec: RequestHandlingSpec<void>
}): ThunkAction {
  return abortableThunk(spec, async () => {
    if (
      Object.values(leagueChanges).filter(c => c !== undefined).length === 0 &&
      !leagueImage &&
      !leagueBadge
    ) {
      return
    }

    const formData = new FormData()
    formData.append(
      'leagueChanges',
      JSON.stringify(leagueChanges, (_, value) => (value === '' ? null : value)),
    )

    if (leagueImage) {
      formData.append('image', leagueImage)
    }
    if (leagueBadge) {
      formData.append('badge', leagueBadge)
    }

    await fetchJson(apiUrl`admin/leagues/${id}/`, {
      method: 'PATCH',
      signal: spec.signal,
      body: formData,
    })
  })
}
