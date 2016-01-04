import { List, Record } from 'immutable'

const Channel = new Record({
  name: null,
})

const defaultState = new List([
  new Channel({ name: 'doyoureallywantthem' }),
  new Channel({ name: 'teamliquid' }),
  new Channel({ name: 'x17' }),
  new Channel({ name: 'nohunters' })
])

export default function(state = defaultState, action) {
  return state
}
