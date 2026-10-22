import { DEFAULT_MAX_FILE_SIZE_BYTES, FilesErrorCode } from '../../common/files'
import { TypedIpcRenderer } from '../../common/ipc'
import { fetchJson } from '../network/fetch'
import { postFormWithProgress } from '../network/upload-with-progress'

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
  maxFileSize: number = DEFAULT_MAX_FILE_SIZE_BYTES,
): Promise<T> {
  const file = await ipcRenderer.invoke('fsReadFile', filePath)!
  return uploadBlob(new Blob([file]), getExtension(filePath), apiPath, maxFileSize)
}

/**
 * Uploads a file the user picked or dropped (rather than one read from disk by path), so it works
 * outside the app too. `onProgress` is called with the fraction of the file sent so far.
 */
export async function uploadFile<T>(
  file: File,
  apiPath: string,
  maxFileSize: number = DEFAULT_MAX_FILE_SIZE_BYTES,
  onProgress?: (fraction: number) => void,
): Promise<T> {
  return uploadBlob(file, getExtension(file.name), apiPath, maxFileSize, onProgress)
}

async function uploadBlob<T>(
  blob: Blob,
  extension: string,
  apiPath: string,
  maxFileSize: number,
  onProgress?: (fraction: number) => void,
): Promise<T> {
  if (blob.size > maxFileSize) {
    throw new ClientSideUploadError(
      FilesErrorCode.MaxFileSizeExceeded,
      'The file size exceeds the maximum allowed size.',
    )
  }

  const formData = new FormData()
  formData.append('extension', extension)
  formData.append('file', blob)

  if (onProgress) {
    return postFormWithProgress<T>(apiPath, formData, onProgress)
  }
  const fetchParams = {
    method: 'post',
    body: formData,
  }
  return fetchJson<T>(apiPath, fetchParams)
}
