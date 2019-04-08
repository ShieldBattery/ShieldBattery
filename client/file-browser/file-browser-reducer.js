import { List, Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import { FILE_BROWSER_CHANGE_PATH, FILE_BROWSER_GET_BEGIN, FILE_BROWSER_GET } from '../actions'

export const Folder = new Record({
  type: 'folder',
  name: '',
  path: '',
})
export const File = new Record({
  type: 'file',
  name: '',
  path: '',
  extension: '',
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
  [FILE_BROWSER_GET_BEGIN](state, action) {
    return state.setIn([action.payload.browseId, 'isRequesting'], true)
  },

  [FILE_BROWSER_GET](state, action) {
    if (action.error) {
      return state.update(action.meta.browseId, prev =>
        prev.set('isRequesting', false).set('lastError', action.payload),
      )
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
})
