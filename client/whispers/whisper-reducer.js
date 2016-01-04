import { List, Record } from 'immutable'

const Whisper = new Record({
  from: null,
})

const defaultState = new List([
  new Whisper({ from: 'Pachi' })
])

export default function(state = defaultState, action) {
  return state
}
