import { List, Record } from 'immutable'
import { SNACKBAR_CLOSE, SNACKBAR_OPEN } from '../actions'

export const Snackbar = Record({
  id: null,
  message: '',
  time: -1,
  actionLabel: null,
  action: null,
})

const initialState = new List()

function open(state, action) {
  const bar = new Snackbar(action.payload)
  return state.size === 0 ? state.push(bar) : state.set(1, bar)
}

function close(state, action) {
  const { id } = action.payload
  return state.filter(s => s.id !== id)
}

const handlers = {
  [SNACKBAR_OPEN]: open,
  [SNACKBAR_CLOSE]: close,
}

export default function snackbarsReducer(state = initialState, action) {
  return handlers[action.type] ? handlers[action.type](state, action) : state
}
