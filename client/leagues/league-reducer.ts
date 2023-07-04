import { ReadonlyDeep } from 'type-fest'
import { ClientLeagueUserJson, LeagueId, LeagueJson } from '../../common/leagues'
import { SbUserId } from '../../common/users/sb-user'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface LeagueState {
  byId: Map<LeagueId, LeagueJson>
  past: LeagueId[]
  current: LeagueId[]
  future: LeagueId[]

  selfLeagues: Map<LeagueId, ClientLeagueUserJson>

  // TODO(tec27): We need to evict old entries from these at some point, or navigating through a ton
  // of leaderboards could leak memory
  leaderboard: Map<LeagueId, SbUserId[]>
  leaderboardUsers: Map<LeagueId, Map<SbUserId, ClientLeagueUserJson>>
}

const DEFAULT_STATE: ReadonlyDeep<LeagueState> = {
  byId: new Map(),
  past: [],
  current: [],
  future: [],

  selfLeagues: new Map(),

  leaderboard: new Map(),
  leaderboardUsers: new Map(),
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

  ['@leagues/getLeaderboard'](state, { payload: { league, leaderboard, leagueUsers } }) {
    state.byId.set(league.id, league)
    state.leaderboard.set(league.id, leaderboard)
    state.leaderboardUsers.set(league.id, new Map(leagueUsers.map(l => [l.userId, l])))
  },

  ['@network/connect']() {
    return DEFAULT_STATE
  },
})
