import { List, Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import {
  REPLAYS_GET_BEGIN,
  REPLAYS_GET,
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

  isRequesting: false,
})

export default keyedReducer(new ReplaysState(), {
  [REPLAYS_GET_BEGIN](state, action) {
    return state.set('isRequesting', true)
  },

  [REPLAYS_GET](state, action) {
    if (action.error) {
      return state.set('isRequesting', false)
    }

    const folders = action.payload
      .filter(e => e.isFolder)
      .map(e => new Folder(e))
      .sort((a, b) => a.name.localeCompare(b.name))
    const replays = action.payload
      .filter(e => !e.isFolder)
      .map(e => new Replay(e))
      .sort((a, b) => {
        if (a.date < b.date) return 1
        if (a.date > b.date) return -1
        else return 0
      })

    const { path } = action.meta
    const isRootFolder = path === ''
    if (!isRootFolder) {
      const prevPath = path.lastIndexOf('\\') !== -1 ? path.slice(0, path.lastIndexOf('\\')) : ''
      folders.unshift(new Folder({ name: '<Go up one level>', path: prevPath }))
    }
    return state.set('isRequesting', false)
      .set('folders', new List(folders))
      .set('replays', new List(replays))
  }
})
