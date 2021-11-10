import { List, Record } from 'immutable'
import {
  FILE_BROWSER_CHANGE_PATH,
  FILE_BROWSER_CLEAR_FILES,
  FILE_BROWSER_GET_LIST,
  FILE_BROWSER_GET_LIST_BEGIN,
} from '../actions'
import { keyedReducer } from '../reducers/keyed-reducer'

export const Folder = Record({
  type: 'folder',
  name: '',
  path: '',
})
export const File = Record({
  type: 'file',
  name: '',
  path: '',
  extension: '',
  date: null,
})
export const FileBrowseState = Record({
  folders: new List(),
  files: new List(),
  path: '',

  isRequesting: false,
  lastError: null,
})
export const FileStates = Record({
  replays: new FileBrowseState(),
  maps: new FileBrowseState(),
})

export default keyedReducer(new FileStates(), {
  [FILE_BROWSER_GET_LIST_BEGIN](state, action) {
    return state.setIn([action.payload.browseId, 'isRequesting'], true)
  },

  [FILE_BROWSER_GET_LIST](state, action) {
    if (action.error) {
      return state.update(action.meta.browseId, prev =>
        prev.set('isRequesting', false).set('lastError', action.payload),
      )
    }

    const { browseId, path } = action.meta
    // Ensure that the displayed path and the fetched files are consistent with each other (with
    // displayed path being the source of truth).
    if (state[browseId].path !== path) {
      return state
    }

    const folders = action.payload
      .filter(e => e.isFolder)
      .map(e => new Folder(e))
      .sort((a, b) => a.name.localeCompare(b.name))
    let files = action.payload.filter(e => !e.isFolder).map(e => new File(e))
    if (action.meta.browseId === 'replays') {
      files = files.sort((a, b) => b.date - a.date)
    } else {
      files = files.sort((a, b) => a.name.localeCompare(b.name))
    }

    return state.update(action.meta.browseId, prev =>
      prev
        .set('isRequesting', false)
        .set('lastError', null)
        .set('folders', new List(folders))
        .set('files', new List(files)),
    )
  },

  [FILE_BROWSER_CHANGE_PATH](state, action) {
    return state.setIn([action.payload.browseId, 'path'], action.payload.path)
  },

  [FILE_BROWSER_CLEAR_FILES](state, action) {
    return state.set(action.payload.browseId, new FileBrowseState())
  },
})
