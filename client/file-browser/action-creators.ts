import { ThunkAction } from '../dispatch-registry'
import { abortableThunk, RequestHandlingSpec } from '../network/abortable-thunk'
import { ChangePath, ClearFiles } from './actions'
import { FileBrowserType } from './file-browser-types'
import readFolder from './get-files'

export function getFiles(
  browserType: FileBrowserType,
  browserPath: string,
  rootFolderPath: string,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const files = await readFolder(browserPath)

    dispatch({
      type: '@fileBrowser/getFileList',
      payload: files,
      meta: {
        browserType,
        browserPath,
        rootFolderPath,
      },
    })
  })
}

export function changePath(browserType: FileBrowserType, browserPath: string): ChangePath {
  return {
    type: '@fileBrowser/changePath',
    payload: {
      browserType,
      browserPath,
    },
  }
}

export function clearFiles(browserType: FileBrowserType): ClearFiles {
  return {
    type: '@fileBrowser/clearFiles',
    payload: {
      browserType,
    },
  }
}
