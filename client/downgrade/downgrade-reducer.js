import { Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import { STARCRAFT_DOWNGRADE_BEGIN, STARCRAFT_DOWNGRADE } from '../actions'

export const DowngradeStatus = new Record({
  downgradeInProgress: false,
  lastDowngradeAttempt: -1,
  lastDowngradeError: null,
})

export default keyedReducer(new DowngradeStatus(), {
  [STARCRAFT_DOWNGRADE_BEGIN](state, action) {
    return state
      .set('downgradeInProgress', true)
      .set('lastDowngradeAttempt', action.payload.timestamp)
  },

  [STARCRAFT_DOWNGRADE](state, action) {
    return state
      .set('downgradeInProgress', false)
      .set('lastDowngradeError', action.error ? action.payload : null)
  },
})
