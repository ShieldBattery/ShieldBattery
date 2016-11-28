import { List, Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import {
  REPLAYS_CHANGE_PATH,
  REPLAYS_GET_BEGIN,
  REPLAYS_GET,
  REPLAYS_START_REPLAY,
} from '../actions'

export const Folder = new Record({
  name: '',
  path: '',
})
export const Replay = new Record({
  name: '',
  path: '',
  date: null,
})
export const ReplaysState = new Record({
  folders: new List(),
  replays: new List(),
  path: '',

  isRequesting: false,
  lastError: null,
})

export default keyedReducer(new ReplaysState(), {
  [REPLAYS_GET_BEGIN](state, action) {
    return state.set('isRequesting', true)
  },

  [REPLAYS_GET](state, action) {
    if (action.error) {
      return state.set('isRequesting', false).set('lastError', action.payload)
    }

    const folders = action.payload
      .filter(e => e.isFolder)
      .map(e => new Folder(e))
      .sort((a, b) => a.name.localeCompare(b.name))
    const replays = action.payload
      .filter(e => !e.isFolder)
      .map(e => new Replay(e))
      .sort((a, b) => b.date - a.date)

    return state.set('isRequesting', false)
      .set('lastError', null)
      .set('folders', new List(folders))
      .set('replays', new List(replays))
  },

  [REPLAYS_START_REPLAY](state, action) {
    if (action.error) {
      return state.set('lastError', action.payload)
    }

    return state
  },

  [REPLAYS_CHANGE_PATH](state, action) {
    return state.set('path', action.payload)
  },
})
