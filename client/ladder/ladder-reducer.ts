import { List, Map, Record } from 'immutable'
import { LadderPlayer } from '../../common/ladder'
import { MatchmakingType } from '../../common/matchmaking'
import { SbUserId } from '../../common/users/sb-user'
import { keyedReducer } from '../reducers/keyed-reducer'

export class LadderPlayerRecord
  extends Record({
    rank: 0,
    userId: 0 as SbUserId,
    rating: 0,
    wins: 0,
    losses: 0,
    pWins: 0,
    pLosses: 0,
    tWins: 0,
    tLosses: 0,
    zWins: 0,
    zLosses: 0,
    rWins: 0,
    rLosses: 0,
    rPWins: 0,
    rPLosses: 0,
    rTWins: 0,
    rTLosses: 0,
    rZWins: 0,
    rZLosses: 0,
    lastPlayedDate: 0,
  })
  implements LadderPlayer {}

export class RetrievedRankings extends Record({
  isLoading: false,
  fetchTime: new Date(0),
  lastError: undefined as Error | undefined,
  players: List<LadderPlayerRecord>(),
  lastUpdated: 0,
  totalCount: 0,
}) {}

export class LadderState extends Record({
  typeToRankings: Map<MatchmakingType, RetrievedRankings>(),
}) {}

export default keyedReducer(new LadderState(), {
  ['@ladder/getRankingsBegin'](state, { payload: { matchmakingType, fetchTime } }) {
    const rankings = state.typeToRankings.get(matchmakingType, new RetrievedRankings())
    const newRankings = rankings
      .set('isLoading', true)
      .set('fetchTime', fetchTime)
      .set('lastError', undefined)

    const typeToRankings = state.typeToRankings.set(matchmakingType, newRankings)
    return state.set('typeToRankings', typeToRankings)
  },

  ['@ladder/getRankings'](state, action) {
    const rankings = state.typeToRankings.get(action.meta.matchmakingType, new RetrievedRankings())
    if (action.meta.fetchTime < rankings.fetchTime) {
      // Don't update the state if we aren't the last request outstanding
      return state
    }

    let newRankings = rankings.set('isLoading', false)
    if (action.error) {
      newRankings = newRankings.set('lastError', action.payload)
    } else {
      const { totalCount, players, lastUpdated } = action.payload
      newRankings = newRankings
        .set('lastError', undefined)
        .set('totalCount', totalCount)
        .set('players', List(players.map(p => new LadderPlayerRecord(p))))
        .set('lastUpdated', lastUpdated)
    }

    const typeToRankings = state.typeToRankings.set(action.meta.matchmakingType, newRankings)
    return state.set('typeToRankings', typeToRankings)
  },
})
