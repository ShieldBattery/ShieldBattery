import { useEffect, useState } from 'react'
import { ReadonlyDeep } from 'type-fest'
import { MatchmakingSeasonJson, SeasonId } from '../../common/matchmaking'
import { getMatchmakingSeasons } from '../matchmaking/action-creators'
import { useAppDispatch } from '../redux-hooks'

/** A season as the profile's season-aware tabs read it. */
export interface ProfileSeason {
  id: number
  name: string
  startDate: number
  resetMmr: boolean
}

export type ProfileSeasonsState = 'loading' | 'ready' | 'error'

/**
 * The *full* season list, fetched if the store doesn't have it yet.
 *
 * The profile request only carries the current season, so on a direct load of a profile tab the
 * store has one entry -- and every season-aware decision quietly degrades: the rating chart's
 * line breaks at every boundary and past seasons get no bands, and a season picker collapses to
 * one entry or labels a played season with nothing at all. `/ladder` is the only other thing
 * that fetches the full list, so a tab that needs it has to ask for it too. The endpoint is
 * cached server-side.
 *
 * The state is worth honouring rather than rendering through: a chart or a picker built on a
 * partial list looks plausible and is wrong, which is worse than a moment of loading.
 */
export function useProfileSeasons(seasons: ReadonlyDeep<Map<SeasonId, MatchmakingSeasonJson>>): {
  state: ProfileSeasonsState
  /** Chronological, which is the order both the chart's splitting and its band grouping walk. */
  seasons: ProfileSeason[]
} {
  const dispatch = useAppDispatch()
  const [state, setState] = useState<ProfileSeasonsState>('loading')

  useEffect(() => {
    dispatch(
      getMatchmakingSeasons({
        onSuccess: () => setState('ready'),
        onError: () => setState('error'),
      }),
    )
  }, [dispatch])

  return {
    state,
    seasons: Array.from(seasons.values())
      .map(s => ({ id: s.id, name: s.name, startDate: s.startDate, resetMmr: s.resetMmr }))
      .sort((a, b) => a.startDate - b.startDate),
  }
}
