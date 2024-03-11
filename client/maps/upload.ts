import { FsErrorCode, TypedIpcRenderer } from '../../common/ipc'
import { fetchJson } from '../network/fetch'

const ipcRenderer = new TypedIpcRenderer()

function getExtension(filePath: string) {
  const index = filePath.lastIndexOf('.')
  if (index === -1) {
    return filePath.toLowerCase()
  } else {
    return filePath.slice(index + 1).toLowerCase()
  }
}

export async function upload<T>(filePath: string, apiPath: string): Promise<T> {
  const extension = getExtension(filePath)
  const readFileResult = await ipcRenderer.invoke('fsReadFile', filePath)!
  if (readFileResult.error) {
    if (readFileResult.code === FsErrorCode.FileOrFolderMissing) {
      throw new Error('Filepath ' + filePath + " doesn't exist")
    } else {
      throw new Error('Unexpected FsError: ' + readFileResult.code)
    }
  }

  const formData = new FormData()
  formData.append('extension', extension)
  formData.append('file', new Blob([readFileResult.file]))

  const fetchParams = {
    method: 'post',
    body: formData,
  }
  return fetchJson<T>(apiPath, fetchParams)
}
