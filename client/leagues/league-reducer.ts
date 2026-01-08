import { ReadonlyDeep } from 'type-fest'
import { ClientLeagueUserJson, LeagueId, LeagueJson } from '../../common/leagues/leagues'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface LeagueState {
  byId: Map<LeagueId, LeagueJson>
  past: LeagueId[]
  current: LeagueId[]
  future: LeagueId[]

  selfLeagues: Map<LeagueId, ClientLeagueUserJson>
}

const DEFAULT_STATE: ReadonlyDeep<LeagueState> = {
  byId: new Map(),
  past: [],
  current: [],
  future: [],

  selfLeagues: new Map(),
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@leagues/getList'](state, { payload: { past, current, future, selfLeagues } }) {
    for (const league of past) {
      state.byId.set(league.id, league)
    }
    for (const league of current) {
      state.byId.set(league.id, league)
    }
    for (const league of future) {
      state.byId.set(league.id, league)
    }

    state.past = past.map(l => l.id)
    state.current = current.map(l => l.id)
    state.future = future.map(l => l.id)

    state.selfLeagues = new Map(selfLeagues.map(l => [l.leagueId, l]))
  },

  ['@leagues/get'](state, { payload: { league, selfLeagueUser } }) {
    state.byId.set(league.id, league)

    if (selfLeagueUser) {
      state.selfLeagues.set(league.id, selfLeagueUser)
    } else {
      state.selfLeagues.delete(league.id)
    }
  },

  ['@leagues/join'](state, { payload: { league, selfLeagueUser } }) {
    state.byId.set(league.id, league)
    state.selfLeagues.set(league.id, selfLeagueUser)
  },

  ['@leagues/getLeaderboard'](state, { payload: { league } }) {
    state.byId.set(league.id, league)
  },

  ['@auth/loadCurrentSession']() {
    return DEFAULT_STATE
  },

  ['@auth/logOut']() {
    return DEFAULT_STATE
  },
})
