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
export const FileBrowseState = new Record({
  folders: new List(),
  files: new List(),
  path: '',

  isRequesting: false,
  lastError: null,
})
export const FileStates = new Record({
  replays: new FileBrowseState(),
  maps: new FileBrowseState(),
})

export default keyedReducer(new FileStates(), {
  [REPLAYS_GET_BEGIN](state, action) {
    return state.setIn([action.payload.browseId, 'isRequesting'], true)
  },

  [REPLAYS_GET](state, action) {
    if (action.error) {
      return state.update(action.meta.browseId, prev =>
        prev.set('isRequesting', false).set('lastError', action.payload)
      )
    }

    const folders = action.payload
      .filter(e => e.isFolder)
      .map(e => new Folder(e))
      .sort((a, b) => a.name.localeCompare(b.name))
    let files = action.payload
      .filter(e => !e.isFolder)
      .map(e => new Replay(e))
    if (action.meta.browseId === 'replays') {
      files = files.sort((a, b) => b.date - a.date)
    } else {
      files = files.sort((a, b) => a.name.localeCompare(b.name))
    }

    return state.update(action.meta.browseId, prev => prev
      .set('isRequesting', false)
      .set('lastError', null)
      .set('folders', new List(folders))
      .set('files', new List(files))
    )
  },

  [REPLAYS_START_REPLAY](state, action) {
    return state
  },

  [REPLAYS_CHANGE_PATH](state, action) {
    return state.setIn([action.payload.browseId, 'path'], action.payload.path)
  },
})
