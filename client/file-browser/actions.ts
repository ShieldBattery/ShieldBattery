import { FileBrowserEntry, FileBrowserType } from './file-browser-types'

export type FileBrowserActions = GetFileList | ChangePath | ClearFiles

export interface GetFileList {
  type: '@fileBrowser/getFileList'
  payload: FileBrowserEntry[]
  meta: {
    browserType: FileBrowserType
    browserPath: string
    rootFolderPath: string
  }
}

export interface ChangePath {
  type: '@fileBrowser/changePath'
  payload: {
    browserType: FileBrowserType
    browserPath: string
  }
}

export interface ClearFiles {
  type: '@fileBrowser/clearFiles'
  payload: {
    browserType: FileBrowserType
  }
}
