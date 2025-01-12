import { ReadonlyDeep } from 'type-fest'
import { MatchmakingSeasonJson, SeasonId } from '../../common/matchmaking'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface MatchmakingSeasonsState {
  byId: Map<SeasonId, MatchmakingSeasonJson>
  currentSeasonId?: SeasonId
}

const DEFAULT_STATE: ReadonlyDeep<MatchmakingSeasonsState> = {
  byId: new Map(),
  currentSeasonId: undefined,
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@matchmaking/getMatchmakingSeasons'](state, { payload: { seasons, current } }) {
    for (const season of seasons) {
      state.byId.set(season.id, season)
    }
    state.currentSeasonId = current
  },

  ['@matchmaking/getCurrentMatchmakingSeason'](state, { payload: season }) {
    state.currentSeasonId = season.id
  },

  ['@ladder/getRankings'](state, action) {
    const { season } = action.payload
    state.byId.set(season.id, season)
  },

  ['@ladder/searchRankings'](state, action) {
    const { season } = action.payload
    state.byId.set(season.id, season)
  },

  ['@users/getUserProfile'](state, { payload: { seasons } }) {
    for (const season of seasons) {
      state.byId.set(season.id, season)
    }
  },

  ['@users/getRankingHistory'](state, { payload: { seasons } }) {
    for (const season of seasons) {
      state.byId.set(season.id, season)
    }
  },
})
