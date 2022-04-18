import { Immutable } from 'immer'
import { immerKeyedReducer } from '../reducers/keyed-reducer'
import {
  FileBrowserEntryType,
  FileBrowserFileEntry,
  FileBrowserFolderEntry,
  FileBrowserType,
  FileBrowserUpEntry,
} from './file-browser-types'

export interface FileBrowserState {
  path: string
  upOneDir?: FileBrowserUpEntry
  folders?: FileBrowserFolderEntry[]
  files?: FileBrowserFileEntry[]
}

export interface FileBrowserStates {
  maps?: FileBrowserState
  replays?: FileBrowserState
}

const DEFAULT_FILE_BROWSER_STATE: Immutable<FileBrowserStates> = {
  maps: undefined,
  replays: undefined,
}

export default immerKeyedReducer(DEFAULT_FILE_BROWSER_STATE, {
  ['@fileBrowser/getFileList'](state, action) {
    const { browserType, browserPath, rootFolderPath } = action.meta
    // Ensure that the displayed path and the fetched files are consistent with each other (with
    // displayed path being the source of truth).
    if (state[browserType]?.path !== browserPath) {
      return
    }

    const isRootFolder = browserPath === rootFolderPath
    let upOneDir: FileBrowserUpEntry | undefined
    if (!isRootFolder) {
      upOneDir = {
        type: FileBrowserEntryType.Up,
        name: 'Up one directory',
        path: `${browserPath}\\..`,
      }
    }
    const folders: FileBrowserFolderEntry[] = action.payload
      .filter((e): e is FileBrowserFolderEntry => e.type === FileBrowserEntryType.Folder)
      .sort((a, b) => a.name.localeCompare(b.name))
    let files: FileBrowserFileEntry[] = action.payload.filter(
      (e): e is FileBrowserFileEntry => e.type === FileBrowserEntryType.File,
    )

    if (browserType === FileBrowserType.Replays) {
      files = files.sort((a, b) => b.date.getTime() - a.date.getTime())
    } else {
      files = files.sort((a, b) => a.name.localeCompare(b.name))
    }

    state[browserType] = {
      path: browserPath,
      upOneDir,
      folders,
      files,
    }
  },

  ['@fileBrowser/changePath'](state, action) {
    state[action.payload.browserType] = {
      path: action.payload.browserPath,
    }
  },

  ['@fileBrowser/clearFiles'](state, action) {
    state[action.payload.browserType] = undefined
  },
})
