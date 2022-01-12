import { TypedIpcRenderer } from '../../common/ipc'
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
  const file = await ipcRenderer.invoke('fsReadFile', filePath)!

  const formData = new FormData()
  formData.append('extension', extension)
  formData.append('file', new Blob([file]))

  const fetchParams = {
    method: 'post',
    body: formData,
  }
  return fetchJson<T>(apiPath, fetchParams)
}
