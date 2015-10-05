import Immutable from 'immutable'
import { SERVER_STATUS } from '../actions'

const initialState = Immutable.Map({
  activeUsers: 0,
})

function onServerStatus(state, action) {
  return state.set('activeUsers', action.payload.users)
}

const handlers = {
  [SERVER_STATUS]: onServerStatus,
}

export default function serverStatusReducer(state = initialState, action) {
  return handlers[action.type] ? handlers[action.type](state, action) : state
}
