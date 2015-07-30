import Immutable from 'immutable'
import { REGISTER_FOR_SERVER_STATUS, UNREGISTER_FOR_SERVER_STATUS, SERVER_STATUS } from '../actions'

const initialState = Immutable.Map({
  registered: 0,
  activeUsers: 0,
  lastError: null,
})

function onRegister(state, action) {
  const count = state.get('registered') + 1
  return (state.withMutations(s => s.set('registered', count)))
}

function onUnregister(state, action) {
  const count = state.get('registered') - 1
  return (state.withMutations(s => s.set('registered', count)))
}

function onServerStatus(state, action) {
  if (action.error) {
    return (state.withMutations(s =>
      s.set('activeUsers', null)
        .set('lastError', action.payload.err)
    ))
  } else {
    return (state.withMutations(s =>
      s.set('activeUsers', action.payload.users)
        .set('lastError', null)
    ))
  }
}

const handlers = {
  [REGISTER_FOR_SERVER_STATUS]: onRegister,
  [UNREGISTER_FOR_SERVER_STATUS]: onUnregister,
  [SERVER_STATUS]: onServerStatus,
}

export default function serverStatusReducer(state = initialState, action) {
  return handlers[action.type] ? handlers[action.type](state, action) : state
}
