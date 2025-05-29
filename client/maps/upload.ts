import { FilesErrorCode, MAX_FILE_SIZE } from '../../common/files'
import { TypedIpcRenderer } from '../../common/ipc'
import { fetchJson } from '../network/fetch'

const ipcRenderer = new TypedIpcRenderer()

export function getExtension(filePath: string) {
  const index = filePath.lastIndexOf('.')
  if (index === -1) {
    return filePath.toLowerCase()
  } else {
    return filePath.slice(index + 1).toLowerCase()
  }
}

export class ClientSideUploadError extends Error {
  code: FilesErrorCode

  constructor(code: FilesErrorCode, message: string) {
    super(message)
    this.name = 'ClientSideUploadError'
    this.code = code
  }
}

// TODO(2Pac): Move this outside the "maps" folder. I'm pretty this is already completely generic?
export async function upload<T>(
  filePath: string,
  apiPath: string,
  maxFileSize: number = MAX_FILE_SIZE,
): Promise<T> {
  const extension = getExtension(filePath)
  const file = await ipcRenderer.invoke('fsReadFile', filePath)!

  if (file.byteLength > maxFileSize) {
    throw new ClientSideUploadError(
      FilesErrorCode.MaxFileSizeExceeded,
      'The file size exceeds the maximum allowed size.',
    )
  }

  const formData = new FormData()
  formData.append('extension', extension)
  formData.append('file', new Blob([file]))

  const fetchParams = {
    method: 'post',
    body: formData,
  }
  return fetchJson<T>(apiPath, fetchParams)
}
